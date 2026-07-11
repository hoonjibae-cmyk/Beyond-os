import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAttendanceRecipients } from '../../../lib/attendanceNotifications';
import { getReportSendSettings, resolveRecipientTestMode } from '../../../lib/reportSendSettings';
import { getStudentAttendanceNotificationPreference, isEventExcludedByPreference, upsertStudentAttendanceNotificationPreference } from '../../../lib/attendanceNotificationPreferences';

export const dynamic = 'force-dynamic';

const EVENT_TYPES = ['check_in', 'check_out', 'away', 'return', 'return_overdue'];
const EVENT_LABELS = {
  check_in: '입실',
  check_out: '퇴실',
  away: '외출',
  return: '복귀',
  return_overdue: '복귀 지연',
};

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

function normalizePhone(value = '') {
  return String(value || '').replace(/[^\d]/g, '');
}

function isUsablePhone(value = '') {
  const phone = normalizePhone(value);
  return phone.length >= 10 && phone.length <= 11;
}

function maskPhone(value = '') {
  const phone = normalizePhone(value);
  if (phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function normalizeStatusFilter(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return ['all', 'ok', 'warning', 'blocked', 'excluded'].includes(raw) ? raw : 'all';
}

async function getRecentLogMap(supabase) {
  try {
    const { data, error } = await supabase
      .from('attendance_notification_logs')
      .select('id,student_id,event_type,send_status,error_message,created_at,test_mode')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const map = new Map();
    for (const row of data || []) {
      if (row.student_id && !map.has(row.student_id)) map.set(row.student_id, row);
    }
    return { map, warning: null };
  } catch (error) {
    return { map: new Map(), warning: error?.message || '최근 출결 알림 로그 조회 실패' };
  }
}

function getPreferenceSummary(preference = {}) {
  const excluded = EVENT_TYPES.filter((eventType) => isEventExcludedByPreference(eventType, preference));
  return {
    excludedEventTypes: excluded,
    excludedLabels: excluded.map((eventType) => EVENT_LABELS[eventType] || eventType),
    anyExcluded: excluded.length > 0,
  };
}

function getStudentProblems({ recipients = [], preferenceSummary, recentLog, providerConfigured, testMode, testRecipientConfigured }) {
  const problems = [];
  const warnings = [];

  if (preferenceSummary.anyExcluded) {
    problems.push({ key: 'student_excluded', severity: 'excluded', label: `학생별 제외: ${preferenceSummary.excludedLabels.join(', ')}` });
  }

  if (!recipients.length) {
    problems.push({ key: 'recipient_missing', severity: 'blocked', label: '보호자 연락처 없음' });
  }

  const badPhones = recipients.filter((item) => !isUsablePhone(item.phone));
  if (badPhones.length) {
    problems.push({ key: 'phone_format', severity: 'blocked', label: `전화번호 형식 확인: ${badPhones.map((item) => maskPhone(item.phone)).join(', ')}` });
  }

  if (testMode && !testRecipientConfigured) {
    problems.push({ key: 'test_recipient_missing', severity: 'blocked', label: '테스트모드 ON이나 테스트 수신번호 없음' });
  }

  if (!providerConfigured) {
    warnings.push({ key: 'provider_not_ready', severity: 'warning', label: '출결 알림톡 템플릿/API 설정 확인 필요' });
  }

  if (recentLog?.send_status === 'failed') {
    warnings.push({ key: 'recent_failed', severity: 'warning', label: `최근 발송 실패: ${recentLog.error_message || '-'}` });
  }

  return [...problems, ...warnings];
}

function getRowStatus(problems = []) {
  if (problems.some((item) => item.severity === 'blocked')) return 'blocked';
  if (problems.some((item) => item.severity === 'excluded')) return 'excluded';
  if (problems.some((item) => item.severity === 'warning')) return 'warning';
  return 'ok';
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const url = new URL(request.url);
    const statusFilter = normalizeStatusFilter(url.searchParams.get('status'));
    const keyword = String(url.searchParams.get('student') || '').trim();
    const supabase = getSupabaseAdmin();

    const { data: students, error } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .neq('status', 'inactive')
      .order('name', { ascending: true });
    if (error) throw error;

    const settingsResult = await getReportSendSettings(supabase);
    const envTestMode = boolEnv('KAKAO_RECIPIENT_TEST_MODE', false);
    const testMode = resolveRecipientTestMode(settingsResult.settings, envTestMode);
    const testRecipientConfigured = Boolean(process.env.KAKAO_TEST_RECIPIENT_PHONE || process.env.KAKAO_TEST_RECIPIENT_PHONES);
    const providerConfigured = Boolean(
      process.env.SOLAPI_TEMPLATE_ID_ATTENDANCE
      || process.env.SOLAPI_TEMPLATE_ID_CHECKINOUT
      || process.env.KAKAO_TEMPLATE_CODE_ATTENDANCE
      || process.env.KAKAO_TEMPLATE_CODE_CHECKINOUT
    );
    const recentLogs = await getRecentLogMap(supabase);

    const preferenceWarnings = [];
    const rows = [];
    for (const student of students || []) {
      if (keyword && !String(student.name || '').includes(keyword)) continue;
      const recipients = await getAttendanceRecipients(supabase, student);
      const preferenceResult = await getStudentAttendanceNotificationPreference(supabase, student.id);
      if (preferenceResult.warning) preferenceWarnings.push(preferenceResult.warning);
      const preferenceSummary = getPreferenceSummary(preferenceResult.preference);
      const recentLog = recentLogs.map.get(student.id) || null;
      const problems = getStudentProblems({ recipients, preferenceSummary, recentLog, providerConfigured, testMode, testRecipientConfigured });
      const rowStatus = getRowStatus(problems);

      rows.push({
        student: {
          id: student.id,
          name: student.name,
          school: student.school,
          grade: student.grade,
          defaultSeatNo: student.default_seat_no,
          status: student.status,
        },
        recipients: recipients.map((item) => ({
          name: item.name,
          relationship: item.relationship,
          phone: item.maskedPhone || maskPhone(item.phone),
          isPrimary: Boolean(item.isPrimary),
        })),
        recipientCount: recipients.length,
        preference: preferenceResult.preference,
        preferenceExists: preferenceResult.exists,
        preferenceSummary,
        recentLog,
        problems,
        status: rowStatus,
      });
    }

    const filteredRows = statusFilter === 'all' ? rows : rows.filter((row) => row.status === statusFilter);
    const summary = rows.reduce((acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (row.recipientCount <= 0) acc.missingRecipient += 1;
      if (row.preferenceSummary.anyExcluded) acc.excluded += 1;
      return acc;
    }, { total: 0, ok: 0, warning: 0, blocked: 0, excluded: 0, missingRecipient: 0 });

    return Response.json({
      ok: true,
      rows: filteredRows,
      summary,
      settings: {
        testMode,
        testRecipientConfigured,
        providerConfigured,
        notificationPolicy: settingsResult.settings?.attendanceNotifications || {},
      },
      warnings: [...new Set([recentLogs.warning, ...preferenceWarnings].filter(Boolean))],
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: `${error.message || '학생별 출결 알림 수신 점검 조회 실패'} / v41-10 SQL 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();

    if (action !== 'save_preference') {
      return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
    }

    const studentId = String(body.studentId || '').trim();
    if (!studentId) return Response.json({ error: 'studentId가 필요합니다.' }, { status: 400 });

    const preference = await upsertStudentAttendanceNotificationPreference(supabase, studentId, body.preference || {});
    return Response.json({ ok: true, preference, message: '학생별 출결 알림 제외 설정을 저장했습니다.' });
  } catch (error) {
    return Response.json({
      ok: false,
      error: `${error.message || '학생별 출결 알림 제외 설정 저장 실패'} / beyond-os-supabase-attendance-notification-preferences-v41-10.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}
