import { getReportSendSettings, isAttendanceNotificationEnabled, resolveRecipientTestMode } from './reportSendSettings';
import { getStudentAttendanceNotificationPreference, isEventExcludedByPreference } from './attendanceNotificationPreferences';

export const ATTENDANCE_NOTIFICATION_TYPES = new Set(['check_in', 'check_out', 'away', 'return', 'return_overdue']);

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

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function uniqueByPhone(rows = []) {
  const seen = new Set();
  return rows.filter((item) => {
    const phone = normalizePhone(item.phone || item.phoneDigits);
    if (!phone || seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}

function maskPhone(value = '') {
  const phone = normalizePhone(value);
  if (phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function formatKstDate(value = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {}
  return new Date(value).toISOString().slice(0, 10);
}

function formatKstTime(value = new Date()) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {}
  return new Date(value).toISOString().slice(11, 16);
}

function normalizeSourceType(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'kiosk') return 'kiosk';
  if (raw === 'manual') return 'manual';
  if (raw === 'system') return 'system';
  return 'manual';
}

export function getAttendanceSourceLabel(sourceType = 'manual', sourceLabel = '') {
  const normalized = normalizeSourceType(sourceType);
  if (normalized === 'kiosk') return '키오스크 자동기록';
  if (normalized === 'system') return sourceLabel || '시스템 자동기록';
  return sourceLabel || '관리자 수동기록';
}

function buildMessage({ studentName, eventType, eventAt, sourceType, sourceLabel, notificationMeta = {} }) {
  const label = EVENT_LABELS[eventType] || '출결';
  const sourceText = getAttendanceSourceLabel(sourceType, sourceLabel);

  if (eventType === 'return_overdue') {
    const awayTime = notificationMeta.awayStartedAt ? formatKstTime(notificationMeta.awayStartedAt) : '-';
    const expectedTime = notificationMeta.expectedReturnAt ? formatKstTime(notificationMeta.expectedReturnAt) : formatKstTime(eventAt);
    const graceMinutes = Number(notificationMeta.graceMinutes ?? 0);
    return `[The Place 26 복귀 지연 알림]\n\n${studentName} 학생의 복귀 예정 시간이 지났지만 아직 복귀 기록이 없습니다.\n\n- 외출시간: ${awayTime}\n- 복귀예정: ${expectedTime}\n- 지연기준: ${graceMinutes}분 초과\n- 기록방식: ${sourceText}\n\n목동유쌤영어학원`;
  }

  return `[The Place 26 ${label} 알림]\n\n${studentName} 학생이 ${label}했습니다.\n\n- ${label}시간: ${formatKstTime(eventAt)}\n- 기록방식: ${sourceText}\n\n목동유쌤영어학원`;
}

function buildTemplateVariables({ studentName, eventType, eventAt, sourceType, sourceLabel, notificationMeta = {} }) {
  const eventLabel = EVENT_LABELS[eventType] || '출결';
  const sourceText = getAttendanceSourceLabel(sourceType, sourceLabel);
  const attendanceTime = eventType === 'return_overdue' && notificationMeta.expectedReturnAt
    ? `${formatKstTime(notificationMeta.expectedReturnAt)} 예정`
    : formatKstTime(eventAt);
  return {
    '#{학생명}': studentName || '',
    '#{날짜}': formatKstDate(eventAt),
    '#{출결구분}': eventLabel,
    '#{출결시간}': attendanceTime,
    '#{기록방식}': sourceText,
  };
}

async function getStudentWithGuardians(supabase, studentId, fallbackStudent = null) {
  if (!studentId) return fallbackStudent;
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('id', studentId)
      .maybeSingle();
    if (error) throw error;
    return data || fallbackStudent;
  } catch {
    return fallbackStudent;
  }
}

export async function getAttendanceRecipients(supabase, student = {}) {
  const hydrated = await getStudentWithGuardians(supabase, student?.id, student);
  const guardians = Array.isArray(hydrated?.student_guardians) ? hydrated.student_guardians : [];
  const activeGuardians = guardians
    .filter((item) => item?.is_active !== false)
    .filter((item) => normalizePhone(item.phone));

  const recipientRows = activeGuardians.map((item, index) => ({
    name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
    relationship: item.relationship || '',
    phone: item.phone,
    phoneDigits: normalizePhone(item.phone),
    maskedPhone: maskPhone(item.phone),
    isPrimary: Boolean(item.is_primary || index === 0),
  }));

  const fallbackPhone = normalizePhone(hydrated?.parent_phone || student?.parent_phone);
  if (!recipientRows.length && fallbackPhone) {
    recipientRows.push({
      name: '대표 보호자',
      relationship: '보호자',
      phone: hydrated?.parent_phone || student?.parent_phone,
      phoneDigits: fallbackPhone,
      maskedPhone: maskPhone(fallbackPhone),
      isPrimary: true,
    });
  }

  return uniqueByPhone(recipientRows).map((item) => ({
    ...item,
    phone: item.phoneDigits,
  }));
}

function getOriginFromRequest(request) {
  try {
    return new URL(request.url).origin;
  } catch {}
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

async function insertNotificationLog(supabase, payload = {}) {
  try {
    const { data, error } = await supabase
      .from('attendance_notification_logs')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return { log: data, error: null };
  } catch (error) {
    return { log: null, error };
  }
}

async function updateNotificationLog(supabase, id, patch = {}) {
  if (!id) return { log: null, error: null };
  try {
    const { data, error } = await supabase
      .from('attendance_notification_logs')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return { log: data, error: null };
  } catch (error) {
    return { log: null, error };
  }
}

async function findExistingNotification(supabase, idempotencyKey) {
  if (!idempotencyKey) return null;
  try {
    const { data, error } = await supabase
      .from('attendance_notification_logs')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}

function makeIdempotencyKey({ studentId, eventType, eventAt, sourceType }) {
  const date = formatKstDate(eventAt);
  const time = formatKstTime(eventAt).replace(/[^\d]/g, '').slice(0, 4) || '0000';
  return `attendance:${studentId}:${eventType}:${date}:${time}:${normalizeSourceType(sourceType)}`;
}

function getWebhookUrl(request) {
  const origin = getOriginFromRequest(request);
  if (!origin) return '';
  return new URL('/api/kakao-send-webhook', origin).toString();
}

function mapSendStatus(json = {}, responseOk = true) {
  const raw = String(json.status || '').toLowerCase();
  if (!responseOk || json.ok === false || raw === 'failed') return 'failed';
  if (raw === 'sent') return 'sent';
  if (raw === 'received') return 'received';
  return raw || 'received';
}

function getPayloadNotificationType(eventType) {
  if (eventType === 'check_in') return 'attendance_check_in';
  if (eventType === 'check_out') return 'attendance_check_out';
  if (eventType === 'away') return 'attendance_away';
  if (eventType === 'return') return 'attendance_return';
  if (eventType === 'return_overdue') return 'attendance_return_overdue';
  return 'attendance_event';
}

export async function sendAttendanceNotification({
  supabase,
  request,
  attendanceEvent,
  session,
  student,
  sourceType = 'manual',
  sourceLabel = '',
  createdBy = '관리자',
  notificationType = null,
  notificationMeta = {},
  forceResend = false,
  resendOfLogId = null,
} = {}) {
  const eventType = notificationType || attendanceEvent?.event_type;
  if (!ATTENDANCE_NOTIFICATION_TYPES.has(eventType)) {
    return { ok: true, skipped: true, reason: 'not_attendance_notification_type' };
  }

  const studentId = attendanceEvent?.student_id || session?.student_id || student?.id;
  if (!studentId) return { ok: false, skipped: true, reason: 'student_missing' };

  const settingsResult = await getReportSendSettings(supabase);
  const notificationSettings = settingsResult.settings?.attendanceNotifications || {};
  if (!isAttendanceNotificationEnabled(eventType, notificationSettings)) {
    return { ok: true, skipped: true, reason: 'notification_disabled_by_settings', eventType };
  }

  const eventAt = notificationMeta.eventAt || notificationMeta.expectedReturnAt || attendanceEvent?.event_at || new Date().toISOString();
  const effectiveSourceType = normalizeSourceType(sourceType || attendanceEvent?.source_type || 'manual');
  const effectiveSourceLabel = sourceLabel || attendanceEvent?.source_label || getAttendanceSourceLabel(effectiveSourceType);
  const hydratedStudent = await getStudentWithGuardians(supabase, studentId, student || session?.students || null);
  const studentName = hydratedStudent?.name || student?.name || '학생';
  const baseIdempotencyKey = makeIdempotencyKey({ studentId, eventType, eventAt, sourceType: effectiveSourceType });
  const idempotencyKey = forceResend
    ? `${baseIdempotencyKey}:resend:${resendOfLogId || Date.now()}`
    : baseIdempotencyKey;
  const existing = await findExistingNotification(supabase, idempotencyKey);
  if (!forceResend && existing && ['ready', 'received', 'sent', 'skipped'].includes(String(existing.send_status || '').toLowerCase())) {
    return { ok: true, skipped: true, duplicate: true, log: existing, reason: 'duplicate_notification_guard' };
  }

  const preferenceResult = await getStudentAttendanceNotificationPreference(supabase, studentId);
  const studentExcluded = isEventExcludedByPreference(eventType, preferenceResult.preference);

  const recipients = await getAttendanceRecipients(supabase, hydratedStudent || student || {});
  const messageText = buildMessage({ studentName, eventType, eventAt, sourceType: effectiveSourceType, sourceLabel: effectiveSourceLabel, notificationMeta });
  const templateVariables = buildTemplateVariables({ studentName, eventType, eventAt, sourceType: effectiveSourceType, sourceLabel: effectiveSourceLabel, notificationMeta });
  const envTestMode = boolEnv('KAKAO_RECIPIENT_TEST_MODE', false);
  const testMode = resolveRecipientTestMode(settingsResult.settings, envTestMode);

  const baseLogPayload = {
    attendance_event_id: attendanceEvent?.id || null,
    session_id: attendanceEvent?.session_id || session?.id || null,
    student_id: studentId,
    event_type: eventType,
    event_at: eventAt,
    source_type: effectiveSourceType,
    source_label: effectiveSourceLabel,
    message_text: messageText,
    recipient_count: recipients.length,
    recipient_snapshot: recipients.map((item) => ({
      name: item.name,
      relationship: item.relationship,
      phone: item.maskedPhone || maskPhone(item.phone),
      isPrimary: Boolean(item.isPrimary),
    })),
    recipient_phone_snapshot: recipients.map((item) => item.maskedPhone || maskPhone(item.phone)).join(', '),
    send_status: recipients.length ? 'ready' : 'failed',
    provider: 'kakao_send_webhook',
    test_mode: testMode,
    idempotency_key: idempotencyKey,
    created_by: createdBy || '관리자',
    error_message: studentExcluded
      ? '학생별 출결 알림 제외 설정으로 발송하지 않았습니다.'
      : recipients.length ? null : '수신 보호자 연락처가 없습니다.',
  };

  const { log, error: insertError } = await insertNotificationLog(supabase, {
    ...baseLogPayload,
    send_status: studentExcluded ? 'skipped' : baseLogPayload.send_status,
    provider_status: studentExcluded ? 'student_preference_excluded' : baseLogPayload.provider_status,
    provider_response: studentExcluded ? { reason: 'student_attendance_notification_excluded', preference: preferenceResult.preference } : baseLogPayload.provider_response,
  });
  if (insertError) {
    // SQL 미적용 환경에서도 출결 반영은 막지 않습니다.
    return { ok: false, skipped: true, reason: 'log_insert_failed', error: insertError.message || String(insertError) };
  }

  if (studentExcluded) {
    return { ok: true, skipped: true, reason: 'student_notification_excluded', log };
  }

  if (!recipients.length) {
    return { ok: false, skipped: true, reason: 'recipient_missing', log };
  }

  const webhookUrl = getWebhookUrl(request);
  if (!webhookUrl) {
    const updated = await updateNotificationLog(supabase, log.id, {
      send_status: 'failed',
      error_message: '내부 카카오 발송 Webhook URL을 만들 수 없습니다.',
    });
    return { ok: false, reason: 'webhook_url_missing', log: updated.log || log };
  }

  const payload = {
    channel: 'kakao',
    reportType: 'attendance',
    notificationType: getPayloadNotificationType(eventType),
    studentId,
    studentName,
    sessionId: session?.id || attendanceEvent?.session_id || null,
    attendanceEventId: attendanceEvent?.id || null,
    reportId: attendanceEvent?.id || log.id,
    recipientPhones: recipients.map((item) => item.phone),
    recipients: recipients.map((item) => ({
      name: item.name,
      relationship: item.relationship,
      phone: item.phone,
      isPrimary: Boolean(item.isPrimary),
    })),
    messageText,
    templateVariables: {
      kakaoVariables: templateVariables,
      studentName,
      date: templateVariables['#{날짜}'],
      attendanceEventType: templateVariables['#{출결구분}'],
      attendanceTime: templateVariables['#{출결시간}'],
      attendanceSource: templateVariables['#{기록방식}'],
    },
    idempotencyKey,
    actualSend: true,
    requestedBy: createdBy || '관리자',
    requestedAt: new Date().toISOString(),
    metadata: {
      sourceType: effectiveSourceType,
      sourceLabel: effectiveSourceLabel,
      eventAt,
      notificationMeta,
    },
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.KAKAO_SEND_WEBHOOK_SECRET || process.env.REPORT_SEND_WEBHOOK_SECRET) {
      headers['x-beyond-webhook-secret'] = process.env.KAKAO_SEND_WEBHOOK_SECRET || process.env.REPORT_SEND_WEBHOOK_SECRET;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const sendStatus = mapSendStatus(json || {}, response.ok);
    const updated = await updateNotificationLog(supabase, log.id, {
      send_status: sendStatus,
      provider: json?.provider || 'kakao_send_webhook',
      provider_status: json?.providerStatus || json?.providerMode || json?.status || null,
      request_id: json?.requestId || json?.idempotencyKey || null,
      recipient_policy: json?.recipientPolicy || null,
      provider_response: json || { raw: text, httpStatus: response.status },
      error_message: sendStatus === 'failed' ? (json?.message || json?.error || text || `HTTP ${response.status}`) : null,
    });

    return {
      ok: response.ok && sendStatus !== 'failed',
      status: sendStatus,
      log: updated.log || log,
      response: json || text,
    };
  } catch (error) {
    const updated = await updateNotificationLog(supabase, log.id, {
      send_status: 'failed',
      provider_status: 'request_error',
      error_message: error.message || '출결 알림톡 발송 요청 실패',
      provider_response: { error: error.message || String(error) },
    });
    return { ok: false, status: 'failed', log: updated.log || log, error: error.message || String(error) };
  }
}
