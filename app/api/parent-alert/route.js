import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function toHHMM(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}`;
}

function formatStudyRange({ plannedStudyTime, plannedCheckIn, plannedCheckOut, schedule } = {}) {
  if (plannedStudyTime) return String(plannedStudyTime);
  const start = toHHMM(plannedCheckIn || schedule?.planned_check_in);
  const end = toHHMM(plannedCheckOut || schedule?.planned_check_out);
  if (start && end) return `${start} ~ ${end}`;
  return '-';
}

function formatBreakRange({ plannedBreakTime, breakItem, breakReason, reason } = {}) {
  if (plannedBreakTime) return String(plannedBreakTime);
  const start = toHHMM(breakItem?.leave_start || breakItem?.leaveStart);
  const end = toHHMM(breakItem?.return_time || breakItem?.returnTime);
  const detail = String(breakReason || reason || breakItem?.reason_detail || breakItem?.reason || '').trim();
  if (start && end) return `${start} ~ ${end}${detail ? ` (${detail})` : ''}`;
  return '없음';
}

function getStatusText({ alertType, currentStatus, currentStatusText, breakItem } = {}) {
  if (currentStatusText) return String(currentStatusText);
  if (alertType === 'return_check') return '외출 후 미복귀';
  if (alertType === 'check_in_check') return '예정 시간 내 미입실';
  if (alertType === 'attendance_mismatch') {
    if (currentStatus === 'away') return '예정 학습 시간 중 외출 상태';
    if (currentStatus === 'out') return '예정 학습 시간 중 퇴실 상태';
    return '예정 학습 시간 중 미입실 상태';
  }
  if (breakItem) return '외출 일정 확인 필요';
  return '출결 상태 확인 필요';
}

function buildMessage({ studentName, plannedStudyTime, plannedBreakTime, currentStatusText }) {
  return `[The Place 26 학부모 확인 요청]\n\n${studentName} 학생의 비욘드 썸머스쿨 출결 확인이 필요한 상황이 발생했습니다.\n\n- 금일 예정 학습 시간: ${plannedStudyTime || '-'}\n- 금일 예정 외출 시간: ${plannedBreakTime || '없음'}\n- 현재 상태: ${currentStatusText || '출결 상태 확인 필요'}\n\n담당자가 학생 확인을 진행한 뒤, 필요 시 학부모님께 추가 연락드리겠습니다.\n\n목동유쌤영어학원`;
}

function buildTemplateVariables({ studentName, plannedStudyTime, plannedBreakTime, currentStatusText }) {
  return {
    '#{학생명}': studentName || '학생',
    '#{예정학습시간}': plannedStudyTime || '-',
    '#{예정외출시간}': plannedBreakTime || '없음',
    '#{현재상태}': currentStatusText || '출결 상태 확인 필요',
  };
}

async function getParentRecipients(supabase, studentId, fallbackStudent = {}) {
  let student = fallbackStudent || {};
  if (studentId) {
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, parent_phone, student_guardians(*)')
        .eq('id', studentId)
        .maybeSingle();
      if (data) student = data;
    } catch {
      try {
        const { data } = await supabase
          .from('students')
          .select('id, name, parent_phone')
          .eq('id', studentId)
          .maybeSingle();
        if (data) student = data;
      } catch {
        // 학생 조회 실패 시 fallback만 사용합니다.
      }
    }
  }

  const guardians = Array.isArray(student?.student_guardians) ? student.student_guardians : [];
  const activeGuardians = guardians
    .filter((item) => item?.is_active !== false && normalizePhone(item.phone))
    .map((item, index) => ({
      name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
      relationship: item.relationship || '',
      phone: normalizePhone(item.phone),
      isPrimary: Boolean(item.is_primary),
    }));

  if (activeGuardians.length) return activeGuardians;

  const fallbackPhone = normalizePhone(student?.parent_phone || fallbackStudent?.parentPhone || fallbackStudent?.parent_phone);
  return fallbackPhone ? [{ name: '대표 보호자', relationship: '대표 보호자', phone: fallbackPhone, isPrimary: true }] : [];
}

async function callKakaoSendWebhook(request, payload) {
  const url = new URL('/api/kakao-send-webhook', request.url);
  const headers = { 'Content-Type': 'application/json' };
  const secret = process.env.KAKAO_SEND_WEBHOOK_SECRET || process.env.REPORT_SEND_WEBHOOK_SECRET || '';
  if (secret) headers['x-beyond-webhook-secret'] = secret;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { response, body: json || { raw: text } };
}

function normalizeAction(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'send') return 'send';
  if (raw === 'draft') return 'draft';
  return 'preview';
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = normalizeAction(body.action);
    const actor = getAuthorizedUser(request);
    const actorName = body.adminName || actor?.displayName || '관리자';
    const supabase = getSupabaseAdmin();

    const studentName = body.studentName || body.student?.name || '학생';
    const plannedStudyTime = formatStudyRange({
      plannedStudyTime: body.plannedStudyTime,
      plannedCheckIn: body.plannedCheckIn,
      plannedCheckOut: body.plannedCheckOut,
      schedule: body.schedule,
    });
    const plannedBreakTime = formatBreakRange({
      plannedBreakTime: body.plannedBreakTime,
      breakItem: body.breakItem,
      breakReason: body.breakReason,
      reason: body.reason,
    });
    const currentStatusText = getStatusText({
      alertType: body.alertType,
      currentStatus: body.currentStatus,
      currentStatusText: body.currentStatusText,
      breakItem: body.breakItem,
    });
    const messageText = body.messageText || buildMessage({ studentName, plannedStudyTime, plannedBreakTime, currentStatusText });
    const kakaoVariables = buildTemplateVariables({ studentName, plannedStudyTime, plannedBreakTime, currentStatusText });
    const recipients = await getParentRecipients(supabase, body.studentId, body.student || { name: studentName, parent_phone: body.parentPhone });

    const preview = {
      studentName,
      plannedStudyTime,
      plannedBreakTime,
      currentStatusText,
      messageText,
      templateVariables: kakaoVariables,
      recipients: recipients.map((item) => ({ ...item, phoneMasked: maskPhone(item.phone) })),
      recipientCount: recipients.length,
      templateEnvName: 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION',
    };

    if (action === 'preview') {
      return Response.json({ ok: true, mode: 'preview', ...preview });
    }

    const insertPayload = {
      student_id: body.studentId || null,
      schedule_id: isUuid(body.scheduleId || body.schedule?.id) ? (body.scheduleId || body.schedule?.id) : null,
      break_id: isUuid(body.breakId || body.breakItem?.id) ? (body.breakId || body.breakItem?.id) : null,
      notification_type: body.alertType || 'parent_confirmation',
      message_text: messageText,
      send_status: action === 'draft' ? 'draft' : 'ready',
      sent_channel: action === 'draft' ? 'preview_draft' : 'kakao_send_webhook',
      created_by: actorName,
    };

    const { data: log, error: insertError } = await supabase
      .from('parent_notification_logs')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) throw insertError;

    if (action === 'draft') {
      return Response.json({ ok: true, mode: 'draft', log, ...preview, message: '학부모 확인 요청 초안을 저장했습니다.' });
    }

    if (!recipients.length) {
      const { data: failedLog } = await supabase
        .from('parent_notification_logs')
        .update({ send_status: 'failed', sent_channel: 'recipient_missing' })
        .eq('id', log.id)
        .select()
        .maybeSingle();
      return Response.json({ ok: false, mode: 'send', log: failedLog || log, ...preview, message: '보호자 연락처가 없어 발송할 수 없습니다.', errorCode: 'PARENT_RECIPIENT_MISSING' }, { status: 400 });
    }

    const idempotencyKey = `parent_confirmation:${log.id}:${body.studentId || 'student'}:${Date.now()}`;
    const payload = {
      channel: 'kakao',
      reportType: 'parent_confirmation',
      notificationType: 'parent_confirmation',
      studentId: body.studentId || null,
      studentName,
      reportId: log.id,
      recipientPhones: recipients.map((item) => item.phone),
      recipients,
      messageText,
      templateVariables: {
        kakaoVariables,
        studentName,
        plannedStudyTime,
        plannedBreakTime,
        currentStatusText,
      },
      idempotencyKey,
      actualSend: true,
      requestedBy: actorName,
      requestedAt: new Date().toISOString(),
      metadata: {
        source: 'schedule_alert_center',
        alertType: body.alertType || 'parent_confirmation',
        scheduleId: body.scheduleId || body.schedule?.id || null,
        breakId: body.breakId || body.breakItem?.id || null,
        currentStatus: body.currentStatus || null,
      },
    };

    const { response, body: sendResult } = await callKakaoSendWebhook(request, payload);
    const sendStatus = sendResult?.status === 'failed' || response.ok === false ? 'failed' : sendResult?.status || 'received';
    const { data: updatedLog } = await supabase
      .from('parent_notification_logs')
      .update({
        send_status: sendStatus,
        sent_channel: sendResult?.provider || 'kakao_send_webhook',
      })
      .eq('id', log.id)
      .select()
      .maybeSingle();

    return Response.json({
      ok: response.ok && sendStatus !== 'failed',
      mode: 'send',
      log: updatedLog || log,
      ...preview,
      sendResult,
      status: sendStatus,
      idempotencyKey,
      message: sendStatus === 'failed'
        ? (sendResult?.message || '학부모 확인 요청 알림톡 발송에 실패했습니다.')
        : '학부모 확인 요청 알림톡 발송 요청이 접수되었습니다.',
    }, { status: response.ok ? 200 : response.status });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
