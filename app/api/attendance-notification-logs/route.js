import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';

function clampLimit(value, fallback = 80) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(200, Math.max(1, Math.round(num)));
}

function normalizeStatus(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return ['ready', 'received', 'sent', 'failed', 'skipped'].includes(raw) ? raw : 'all';
}

function normalizeEventType(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return ['check_in', 'check_out', 'away', 'return', 'return_overdue'].includes(raw) ? raw : 'all';
}

function getProviderResponse(row = {}) {
  const value = row.provider_response;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function getFailureDiagnosis(row = {}) {
  const status = String(row.send_status || '').toLowerCase();
  const error = String(row.error_message || '').trim();
  const providerStatus = String(row.provider_status || '').trim();
  const providerResponse = getProviderResponse(row);
  const responseErrorCode = providerResponse.errorCode || providerResponse.error_code || providerResponse.code || providerResponse.reason;
  const responseMessage = providerResponse.message || providerResponse.error || providerResponse.raw;
  const text = `${error} ${providerStatus} ${responseErrorCode || ''} ${responseMessage || ''}`.toLowerCase();

  if (status !== 'failed' && status !== 'skipped') {
    return {
      level: status === 'sent' ? 'done' : 'pending',
      label: status === 'sent' ? '발송완료' : status === 'received' ? '요청접수' : '처리 중',
      detail: status === 'received' ? '카카오 제공자 또는 안전모드에서 요청을 접수한 상태입니다.' : '실패 사유가 없습니다.',
      actionHint: status === 'received' ? '실제 발송 여부는 제공자 콘솔 또는 테스트 수신번호에서 함께 확인하세요.' : '',
    };
  }

  if (text.includes('학생별 출결 알림 제외') || text.includes('student_attendance_notification_excluded') || text.includes('student_preference_excluded')) {
    return { level: 'neutral', label: '학생별 제외 설정', detail: '해당 학생의 출결 알림 제외 설정 때문에 발송하지 않았습니다.', actionHint: '학생별 수신 점검에서 제외 설정을 해제한 뒤 필요 시 재발송하세요.' };
  }
  if (text.includes('수신 보호자 연락처') || text.includes('recipient_missing')) {
    return { level: 'failed', label: '보호자 연락처 없음', detail: '발송 가능한 활성 보호자 연락처가 없습니다.', actionHint: '학생 관리에서 보호자 연락처를 저장한 뒤 재발송하세요.' };
  }
  if (text.includes('kakao_test_recipient_missing') || text.includes('테스트 수신번호')) {
    return { level: 'failed', label: '테스트 수신번호 없음', detail: '테스트모드가 ON이지만 Vercel 테스트 수신번호가 없습니다.', actionHint: 'KAKAO_TEST_RECIPIENT_PHONE 또는 KAKAO_TEST_RECIPIENT_PHONES를 설정하세요.' };
  }
  if (text.includes('template') || text.includes('템플릿')) {
    return { level: 'failed', label: '템플릿 설정 확인', detail: '출결 알림톡 템플릿 ID/코드가 없거나 제공자에서 거부되었습니다.', actionHint: 'SOLAPI_TEMPLATE_ID_ATTENDANCE 또는 KAKAO_TEMPLATE_CODE_ATTENDANCE를 확인하세요.' };
  }
  if (text.includes('allowlist')) {
    return { level: 'failed', label: 'Allowlist 차단', detail: '허용된 수신번호 목록에 없는 번호라 실제 발송이 차단되었습니다.', actionHint: 'KAKAO_RECIPIENT_ALLOWLIST 값을 확인하세요.' };
  }
  if (text.includes('fail-safe') || text.includes('failsafe')) {
    return { level: 'pending', label: 'Fail-safe 차단', detail: 'Fail-safe 모드가 켜져 실제 발송하지 않고 요청 접수로만 처리되었습니다.', actionHint: '실제 발송하려면 KAKAO_FAIL_SAFE_MODE=false 전환 여부를 신중히 확인하세요.' };
  }
  if (text.includes('webhook') || text.includes('url')) {
    return { level: 'failed', label: 'Webhook/API 연결 확인', detail: '내부 또는 외부 발송 API 호출 중 문제가 발생했습니다.', actionHint: 'Vercel 환경변수와 제공자 API 상태를 확인하세요.' };
  }

  return {
    level: status === 'skipped' ? 'neutral' : 'failed',
    label: status === 'skipped' ? '발송 건너뜀' : '발송 실패',
    detail: error || providerStatus || responseMessage || '구체적인 실패 사유가 기록되지 않았습니다.',
    actionHint: '보호자 연락처, 테스트모드, 템플릿 ID, 제공자 응답을 순서대로 확인하세요.',
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const status = normalizeStatus(url.searchParams.get('status'));
    const eventType = normalizeEventType(url.searchParams.get('eventType'));
    const studentKeyword = String(url.searchParams.get('student') || '').trim();
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('attendance_notification_logs')
      .select('*, students(id,name,school,grade,parent_phone), attendance_events(id,event_type,event_at,source_type,source_label,student_id,session_id), daily_sessions(id,seat_no,session_date,student_id)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') query = query.eq('send_status', status);
    if (eventType !== 'all') query = query.eq('event_type', eventType);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (studentKeyword
      ? (data || []).filter((row) => String(row.students?.name || '').includes(studentKeyword))
      : (data || [])
    ).map((row) => ({ ...row, failureDiagnosis: getFailureDiagnosis(row) }));

    const failureReasons = rows.reduce((acc, row) => {
      if (!['failed', 'skipped'].includes(String(row.send_status || '').toLowerCase())) return acc;
      const label = row.failureDiagnosis?.label || '기타';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});

    const summary = rows.reduce((acc, row) => {
      const key = row.send_status || 'unknown';
      acc.total += 1;
      acc[key] = (acc[key] || 0) + 1;
      if (row.test_mode) acc.testMode += 1;
      if (row.event_type === 'check_in') acc.checkIn += 1;
      if (row.event_type === 'check_out') acc.checkOut += 1;
      if (row.event_type === 'away') acc.away += 1;
      if (row.event_type === 'return') acc.return += 1;
      if (row.event_type === 'return_overdue') acc.returnOverdue += 1;
      return acc;
    }, { total: 0, ready: 0, received: 0, sent: 0, failed: 0, skipped: 0, testMode: 0, checkIn: 0, checkOut: 0, away: 0, return: 0, returnOverdue: 0, failureReasons });

    return Response.json({ ok: true, rows, summary });
  } catch (error) {
    return Response.json({
      ok: false,
      error: `${error.message || '출결 알림 로그 조회 실패'} / beyond-os-supabase-attendance-notifications-v41-07.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const logId = String(body.logId || body.id || '').trim();
    if (action !== 'resend') return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
    if (!logId) return Response.json({ error: 'logId가 필요합니다.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from('attendance_notification_logs')
      .select('*, students(*, student_guardians(*)), attendance_events(*), daily_sessions(*)')
      .eq('id', logId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return Response.json({ error: '재발송할 로그를 찾지 못했습니다.' }, { status: 404 });

    const syntheticEvent = row.attendance_events || {
      id: row.attendance_event_id || null,
      student_id: row.student_id,
      session_id: row.session_id,
      event_type: row.event_type,
      event_at: row.event_at || row.created_at,
      source_type: row.source_type || 'manual',
      source_label: row.source_label || null,
    };

    const result = await sendAttendanceNotification({
      supabase,
      request,
      attendanceEvent: syntheticEvent,
      session: row.daily_sessions || null,
      student: row.students || null,
      sourceType: row.source_type || syntheticEvent.source_type || 'manual',
      sourceLabel: row.source_label || syntheticEvent.source_label || '관리자 재발송',
      createdBy: '관리자 재발송',
      notificationType: row.event_type,
      notificationMeta: {
        eventAt: row.event_at || syntheticEvent.event_at || row.created_at,
        resendOfLogId: row.id,
      },
      forceResend: true,
      resendOfLogId: row.id,
    });

    return Response.json({
      ok: result.ok !== false,
      result,
      message: result.ok === false ? '출결 알림 재발송 요청 중 확인이 필요합니다.' : '출결 알림 재발송 요청을 생성했습니다.',
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message || '출결 알림 재발송 실패',
    }, { status: 500 });
  }
}
