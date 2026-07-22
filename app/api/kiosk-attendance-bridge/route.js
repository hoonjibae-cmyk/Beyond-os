import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { checkKioskBridgeReadiness, buildKioskErrorResponse } from '../../../lib/kioskBridgeDiagnostics';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';

const KIOSK_SOURCE_TYPE = 'kiosk';
const KIOSK_SOURCE_LABEL = '키오스크 자동반영';
const KIOSK_ACTOR = '키오스크 자동반영';

const KIOSK_BRIDGE_SETTINGS_KEY = 'kiosk_bridge_settings';
const DEFAULT_KIOSK_BRIDGE_SETTINGS = {
  autoApplyEnabled: true,
  staleWarningMinutes: 60,
  heartbeatIntervalMinutes: 30,
  manualConflictWindowSeconds: 60,
  overnightCheckoutCorrectionEnabled: true,
  overnightCheckoutGraceMinutes: 60,
  operatingHoursEnabled: true,
  operationStartTime: '09:00',
  operationEndTime: '24:00',
  breakHoldBufferMinutes: 1,
  breakHoldDuplicateWindowSeconds: 30,
};


function normalizeClockTime(value, fallback, { allow24 = false } = {}) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (minute < 0 || minute > 59) return fallback;
  if (allow24 && hour === 24 && minute === 0) return '24:00';
  if (hour < 0 || hour > 23) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeKioskBridgeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const minutes = Number(source.staleWarningMinutes ?? source.stale_warning_minutes ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.staleWarningMinutes);
  const heartbeatMinutes = Number(source.heartbeatIntervalMinutes ?? source.heartbeat_interval_minutes ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.heartbeatIntervalMinutes);
  const manualConflictSeconds = Number(source.manualConflictWindowSeconds ?? source.manual_conflict_window_seconds ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.manualConflictWindowSeconds);
  const overnightGraceMinutes = Number(source.overnightCheckoutGraceMinutes ?? source.overnight_checkout_grace_minutes ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.overnightCheckoutGraceMinutes);
  const breakHoldBufferMinutes = Number(source.breakHoldBufferMinutes ?? source.break_hold_buffer_minutes ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.breakHoldBufferMinutes);
  const breakHoldDuplicateWindowSeconds = Number(source.breakHoldDuplicateWindowSeconds ?? source.break_hold_duplicate_window_seconds ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.breakHoldDuplicateWindowSeconds);
  return {
    autoApplyEnabled: source.autoApplyEnabled ?? source.auto_apply_enabled ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.autoApplyEnabled,
    staleWarningMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : DEFAULT_KIOSK_BRIDGE_SETTINGS.staleWarningMinutes,
    heartbeatIntervalMinutes: Number.isFinite(heartbeatMinutes) && heartbeatMinutes > 0 ? Math.round(heartbeatMinutes) : DEFAULT_KIOSK_BRIDGE_SETTINGS.heartbeatIntervalMinutes,
    manualConflictWindowSeconds: Number.isFinite(manualConflictSeconds) && manualConflictSeconds >= 0 ? Math.round(manualConflictSeconds) : DEFAULT_KIOSK_BRIDGE_SETTINGS.manualConflictWindowSeconds,
    overnightCheckoutCorrectionEnabled: source.overnightCheckoutCorrectionEnabled ?? source.overnight_checkout_correction_enabled ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.overnightCheckoutCorrectionEnabled,
    overnightCheckoutGraceMinutes: Number.isFinite(overnightGraceMinutes) && overnightGraceMinutes >= 0 ? Math.round(overnightGraceMinutes) : DEFAULT_KIOSK_BRIDGE_SETTINGS.overnightCheckoutGraceMinutes,
    operatingHoursEnabled: source.operatingHoursEnabled ?? source.operating_hours_enabled ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.operatingHoursEnabled,
    operationStartTime: normalizeClockTime(source.operationStartTime ?? source.operation_start_time, DEFAULT_KIOSK_BRIDGE_SETTINGS.operationStartTime),
    operationEndTime: normalizeClockTime(source.operationEndTime ?? source.operation_end_time, DEFAULT_KIOSK_BRIDGE_SETTINGS.operationEndTime, { allow24: true }),
    breakHoldBufferMinutes: Number.isFinite(breakHoldBufferMinutes) && breakHoldBufferMinutes >= 0 && breakHoldBufferMinutes <= 30 ? Math.round(breakHoldBufferMinutes) : DEFAULT_KIOSK_BRIDGE_SETTINGS.breakHoldBufferMinutes,
    breakHoldDuplicateWindowSeconds: Number.isFinite(breakHoldDuplicateWindowSeconds) && breakHoldDuplicateWindowSeconds >= 5 && breakHoldDuplicateWindowSeconds <= 120 ? Math.round(breakHoldDuplicateWindowSeconds) : DEFAULT_KIOSK_BRIDGE_SETTINGS.breakHoldDuplicateWindowSeconds,
  };
}

async function getKioskBridgeSettings(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', KIOSK_BRIDGE_SETTINGS_KEY)
      .maybeSingle();
    if (error) return normalizeKioskBridgeSettings(DEFAULT_KIOSK_BRIDGE_SETTINGS);
    return normalizeKioskBridgeSettings(data?.setting_value || DEFAULT_KIOSK_BRIDGE_SETTINGS);
  } catch {
    return normalizeKioskBridgeSettings(DEFAULT_KIOSK_BRIDGE_SETTINGS);
  }
}

function addKstDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00+09:00`);
  d.setDate(d.getDate() + amount);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function midnightAfterKstDate(dateString) {
  return new Date(`${addKstDays(dateString, 1)}T00:00:00+09:00`).toISOString();
}

function getKstMinuteOfDay(value) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(value));
    let hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    if (hour === 24) hour = 0;
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function isWithinOvernightCheckoutGrace(receivedAt, settings = {}) {
  if (settings.overnightCheckoutCorrectionEnabled === false) return false;
  const graceMinutes = Number(settings.overnightCheckoutGraceMinutes ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.overnightCheckoutGraceMinutes);
  if (!Number.isFinite(graceMinutes) || graceMinutes <= 0) return false;
  const minuteOfDay = getKstMinuteOfDay(receivedAt);
  if (minuteOfDay === null) return false;
  return minuteOfDay >= 0 && minuteOfDay <= graceMinutes;
}

function clockToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getBreakHoldWindow(receivedAt, studyWindows = [], bufferMinutes = 1) {
  const minuteOfDay = getKstMinuteOfDay(receivedAt);
  if (minuteOfDay === null) return null;
  const windows = (studyWindows || [])
    .map((item, index) => ({
      label: String(item?.label || `${index + 1}차시`),
      start: clockToMinutes(item?.start),
      end: clockToMinutes(item?.end),
    }))
    .filter((item) => item.start !== null && item.end !== null && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const normalizedBufferMinutes = Number.isFinite(Number(bufferMinutes)) ? Math.max(0, Math.min(30, Math.round(Number(bufferMinutes)))) : 1;

  // 마지막 차시 종료 뒤에는 다음 차시가 없으므로 HOLD를 적용하지 않습니다.
  // 따라서 22시 마지막 차시 퇴실/외출 신호는 즉시 실제 출결로 반영됩니다.
  for (let index = 0; index < windows.length - 1; index += 1) {
    const current = windows[index];
    const next = windows[index + 1];
    if (next.start <= current.end) continue;
    // 차시 종료 직후부터 다음 차시 시작 + 사용자 설정 buffer까지 보류합니다.
    const holdStart = current.end;
    const holdEnd = Math.min(24 * 60, next.start + normalizedBufferMinutes);
    if (minuteOfDay >= holdStart && minuteOfDay <= holdEnd) {
      return {
        previousLabel: current.label,
        nextLabel: next.label,
        startMinute: holdStart,
        endMinute: holdEnd,
        startTime: `${String(Math.floor(holdStart / 60)).padStart(2, '0')}:${String(holdStart % 60).padStart(2, '0')}`,
        endTime: `${String(Math.floor(holdEnd / 60)).padStart(2, '0')}:${String(holdEnd % 60).padStart(2, '0')}`,
      };
    }
  }
  return null;
}

function shouldHoldBreakSignal(eventType) {
  return ['away', 'return', 'check_out', 'check_in'].includes(String(eventType || ''));
}

async function findRecentDuplicateBreakHold({ supabase, studentId, eventType, receivedAt, windowSeconds = 30, breakWindow }) {
  if (!studentId || !eventType || !receivedAt || !breakWindow) return null;
  const normalizedSeconds = Number.isFinite(Number(windowSeconds)) ? Math.max(5, Math.min(120, Math.round(Number(windowSeconds)))) : 30;
  const receivedMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(receivedMs)) return null;
  const fromIso = new Date(receivedMs - normalizedSeconds * 1000).toISOString();
  const toIso = new Date(receivedMs + normalizedSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from('kiosk_attendance_holds')
    .select('id,event_type,event_at,status,import_event_id,break_start_time,break_end_time')
    .eq('student_id', studentId)
    .eq('event_type', eventType)
    .eq('break_start_time', breakWindow.startTime)
    .eq('break_end_time', breakWindow.endTime)
    .gte('event_at', fromIso)
    .lte('event_at', toIso)
    .order('event_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function isSystemAutoCheckoutEvent(event = {}) {
  const sourceType = String(event.source_type || '').toLowerCase();
  const createdBy = String(event.created_by || '').toLowerCase();
  const memo = String(event.memo || '');
  return sourceType === 'system' || createdBy === 'system' || memo.includes('시스템 자동 자정 퇴실') || memo.includes('자정 자동 퇴실');
}

async function findOvernightCheckoutCandidate({ supabase, studentId, receivedAt, settings }) {
  if (!studentId || !receivedAt || !isWithinOvernightCheckoutGrace(receivedAt, settings)) return null;

  const today = getKstDateString(new Date(receivedAt));
  const previousDate = addKstDays(today, -1);
  const midnightIso = midnightAfterKstDate(previousDate);
  const receivedTime = new Date(receivedAt).getTime();
  const midnightTime = new Date(midnightIso).getTime();
  const graceMs = Number(settings.overnightCheckoutGraceMinutes || DEFAULT_KIOSK_BRIDGE_SETTINGS.overnightCheckoutGraceMinutes) * 60000;
  if (!Number.isFinite(receivedTime) || receivedTime < midnightTime || receivedTime > midnightTime + graceMs) return null;

  const { data: previousSession, error: previousSessionError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', studentId)
    .eq('session_date', previousDate)
    .maybeSingle();
  if (previousSessionError) throw previousSessionError;
  if (!previousSession?.id || !previousSession.check_in_at) return null;

  const { data: checkOutEvents, error: eventsError } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('session_id', previousSession.id)
    .eq('event_type', 'check_out')
    .order('event_at', { ascending: false })
    .limit(20);
  if (eventsError) throw eventsError;

  const systemAutoEvent = (checkOutEvents || []).find(isSystemAutoCheckoutEvent) || null;
  const realCheckoutEvent = (checkOutEvents || []).find((event) => !isSystemAutoCheckoutEvent(event)) || null;
  const checkoutTime = previousSession.check_out_at ? new Date(previousSession.check_out_at).getTime() : null;
  const looksAutoClosed = !previousSession.check_out_at
    || Boolean(systemAutoEvent)
    || (Number.isFinite(checkoutTime) && Math.abs(checkoutTime - midnightTime) <= 5 * 60000);

  if (realCheckoutEvent) {
    const eventTime = new Date(realCheckoutEvent.event_at || realCheckoutEvent.created_at || 0).getTime();
    if (Number.isFinite(eventTime) && eventTime >= midnightTime && eventTime <= midnightTime + graceMs) {
      return {
        duplicate: true,
        previousDate,
        midnightIso,
        session: previousSession,
        existingEvent: realCheckoutEvent,
        reason: '자정 이후 실제 키오스크 퇴실이 이미 전날 세션에 보정되어 있습니다.',
      };
    }
  }

  if (!looksAutoClosed) return null;

  return {
    duplicate: false,
    previousDate,
    midnightIso,
    session: previousSession,
    systemAutoEvent,
  };
}

async function applyOvernightCheckoutCorrection({ supabase, student, candidate, receivedAt, importEventId, defaultSchedule }) {
  const previousSession = candidate.session;
  const eventMemo = '자정 시스템 자동퇴실 후 실제 키오스크 퇴실시간으로 보정';
  let awayTotalMinutes = Number(previousSession.away_total_minutes || 0);
  if (previousSession.away_started_at) awayTotalMinutes += diffMinutes(previousSession.away_started_at, receivedAt);

  const nextSessionForCalc = {
    ...previousSession,
    check_out_at: receivedAt,
    away_started_at: null,
    away_total_minutes: awayTotalMinutes,
  };
  const pureStudyMinutes = calculateScheduledPureStudyMinutes(nextSessionForCalc, {
    nowIso: receivedAt,
    studyWindows: defaultSchedule.studyWindows,
  });

  const { data: savedSession, error: sessionError } = await supabase
    .from('daily_sessions')
    .update({
      seat_status: 'out',
      check_out_at: receivedAt,
      away_started_at: null,
      away_total_minutes: awayTotalMinutes,
      pure_study_minutes: pureStudyMinutes,
      pure_study_manual_text: null,
    })
    .eq('id', previousSession.id)
    .select('*, students(*)')
    .single();
  if (sessionError) throw sessionError;

  let savedEvent = null;
  if (candidate.systemAutoEvent?.id) {
    const { data: updatedEvent, error: eventUpdateError } = await supabase
      .from('attendance_events')
      .update({
        event_at: receivedAt,
        memo: eventMemo,
        created_by: KIOSK_ACTOR,
        source_type: KIOSK_SOURCE_TYPE,
        source_label: '키오스크 자동기록',
        import_event_id: importEventId,
      })
      .eq('id', candidate.systemAutoEvent.id)
      .select()
      .single();
    if (eventUpdateError) throw eventUpdateError;
    savedEvent = updatedEvent;
  } else {
    const { data: insertedEvent, error: eventInsertError } = await supabase
      .from('attendance_events')
      .insert({
        session_id: savedSession.id,
        student_id: student.id,
        seat_no: savedSession.seat_no,
        event_type: 'check_out',
        event_at: receivedAt,
        memo: eventMemo,
        created_by: KIOSK_ACTOR,
        source_type: KIOSK_SOURCE_TYPE,
        source_label: '키오스크 자동기록',
        import_event_id: importEventId,
      })
      .select()
      .single();
    if (eventInsertError) throw eventInsertError;
    savedEvent = insertedEvent;
  }

  return { savedSession, savedEvent, pureStudyMinutes, previousDate: candidate.previousDate };
}

function safeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRawMessage(value = '') {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function compactMessage(value = '') {
  return normalizeRawMessage(value).replace(/\s+/g, ' ').trim();
}

function getRequestSecret(request, body = {}) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return request.headers.get('x-kiosk-secret') || bearer || body.secret || body.kioskSecret || '';
}

function assertBridgeAuthorized(request, body = {}) {
  const expected = process.env.KIOSK_BRIDGE_SECRET || '';
  if (!expected) {
    return { ok: false, status: 503, error: 'KIOSK_BRIDGE_SECRET 환경변수가 설정되어 있지 않습니다.' };
  }
  const provided = getRequestSecret(request, body);
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: '키오스크 브릿지 인증에 실패했습니다.' };
  }
  return { ok: true };
}

function getRawText(body = {}) {
  return normalizeRawMessage(
    body.rawText
    || body.message
    || body.text
    || body.notificationText
    || [body.title, body.body].filter(Boolean).join(' ')
  );
}

function isHeartbeatPayload(body = {}, rawText = '') {
  const type = String(body.type || body.eventType || body.kind || '').trim().toLowerCase();
  const text = compactMessage(rawText).toLowerCase();
  if (type === 'heartbeat' || type === 'kiosk_heartbeat') return true;
  if (text === 'kiosk_heartbeat') return true;
  if (text.includes('kiosk_heartbeat')) return true;
  if (text.includes('heartbeat') && text.includes('kiosk')) return true;
  if (text.includes('브릿지폰') && (text.includes('정상') || text.includes('heartbeat'))) return true;
  return false;
}

async function saveImportLogSafe(supabase, existingImport, payload, idempotencyKey) {
  let savedImportEvent = null;
  let importError = null;

  if (existingImport?.id) {
    const result = await supabase
      .from('attendance_import_events')
      .update(payload)
      .eq('id', existingImport.id)
      .select()
      .single();
    savedImportEvent = result.data;
    importError = result.error;
  } else {
    const result = await supabase
      .from('attendance_import_events')
      .insert(payload)
      .select()
      .single();
    savedImportEvent = result.data;
    importError = result.error;

    if (importError?.code === '23505') {
      const retry = await supabase
        .from('attendance_import_events')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (!retry.error && retry.data) {
        return { data: retry.data, error: null, duplicate: true };
      }
    }
  }

  return { data: savedImportEvent, error: importError, duplicate: false };
}


function makeIdempotencyKey({ rawText, sourceDeviceId, receivedAt, explicitKey }) {
  if (explicitKey) return String(explicitKey).trim();
  const iso = receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString();
  const minuteBucket = iso.slice(0, 16);
  return crypto
    .createHash('sha256')
    .update(`${sourceDeviceId || 'android'}|${minuteBucket}|${rawText}`)
    .digest('hex');
}

function eventTypeToSeatStatus(eventType) {
  const map = {
    check_in: 'occupied',
    away: 'away',
    return: 'occupied',
    check_out: 'out',
  };
  return map[eventType] || null;
}

function detectKioskEventType(raw = '') {
  const text = compactMessage(raw);
  // 실제 알림톡에는 <입실>/<외출>/<퇴실>/<재입장> 접두어가 오지 않습니다.
  // 다만 기존 테스트 payload와의 호환성을 위해 접두어가 붙은 형식도 함께 지원합니다.
  const explicit = text.match(/^<\s*(입실|외출|퇴실|재입장)\s*>/);
  if (explicit) return explicit[1];

  // '재입장' 문구는 '입장'을 포함하므로 반드시 입장보다 먼저 판정합니다.
  if (/재입장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /재입장\s*했어요/.test(text) || /다시\s*돌아왔어요/.test(text)) return '재입장';
  if (/외출(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /(?:잠시\s*)?외출\s*했어요/.test(text)) return '외출';
  if (/퇴장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /퇴장\s*했어요/.test(text) || /하원\s*했어요/.test(text)) return '퇴실';
  if (/입장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /입장\s*했어요/.test(text) || /학원에\s*도착했어요/.test(text)) return '입실';
  return '';
}

function stripOptionalTypePrefix(raw = '') {
  return normalizeRawMessage(raw)
    .replace(/^\s*\[\s*Web발신\s*\]\s*/i, '')
    .replace(/^<\s*(입실|외출|퇴실|재입장)\s*>\s*/, '')
    .trim();
}

function stripKnownEventPhrases(text = '') {
  return compactMessage(text)
    .replace(/님이.*$/, '')
    .replace(/학생이.*$/, '')
    .replace(/\s*(?:입장|외출|퇴장|재입장).*$/, '')
    .trim();
}

function matchStudentFromPrefix(prefix = '', activeStudents = []) {
  const normalizedPrefix = compactMessage(prefix);
  const matches = activeStudents
    .filter((student) => normalizedPrefix.endsWith(String(student.name || '').trim()))
    .sort((a, b) => String(b.name || '').length - String(a.name || '').length);

  if (matches.length === 1) return { matchedStudent: matches[0], studentName: matches[0].name };
  if (matches.length > 1 && String(matches[0].name || '').length > String(matches[1].name || '').length) {
    return { matchedStudent: matches[0], studentName: matches[0].name };
  }

  const tokens = normalizedPrefix.split(/\s+/).filter(Boolean);
  return { matchedStudent: null, studentName: tokens[tokens.length - 1] || normalizedPrefix };
}

function normalizeAliasName(value = '') {
  return compactMessage(value).replace(/\s+/g, '').toLowerCase();
}

async function loadKioskStudentAliases(supabase) {
  try {
    const { data, error } = await supabase
      .from('kiosk_student_aliases')
      .select('id, alias_name, student_id, source, is_active, updated_at')
      .eq('is_active', true);
    if (error) return { aliases: [], error };
    return { aliases: data || [], error: null };
  } catch (error) {
    return { aliases: [], error };
  }
}

function findStudentByAlias(parsedStudentName, aliases = [], students = []) {
  const target = normalizeAliasName(parsedStudentName);
  if (!target) return null;
  const alias = (aliases || []).find((item) => normalizeAliasName(item.alias_name) === target);
  if (!alias?.student_id) return null;
  return (students || []).find((student) => student.id === alias.student_id) || null;
}

function parseKioskAlimtalk(rawText = '', students = []) {
  const originalRaw = normalizeRawMessage(rawText);
  const raw = compactMessage(originalRaw);
  const koreanType = detectKioskEventType(originalRaw);
  if (!koreanType) {
    return {
      ok: false,
      error: '지원하지 않는 알림 형식입니다. "입장했습니다/입장했어요/학원에 도착했어요/외출했습니다/잠시 외출했어요/퇴장했습니다/퇴장했어요/하원했어요/재입장을 했습니다/재입장했어요/다시 돌아왔어요" 문구가 포함되어 있는지 확인하세요.',
    };
  }

  const activeStudents = (students || []).filter((student) => student?.status !== 'inactive' && student?.name);
  const cleaned = stripOptionalTypePrefix(originalRaw);
  const compact = compactMessage(cleaned);

  let beforeNameMarker = '';
  let marker = '';
  if (compact.includes('님이')) {
    beforeNameMarker = compact.split('님이')[0]?.trim() || '';
    marker = '님이';
  } else if (compact.includes('학생이')) {
    beforeNameMarker = compact.split('학생이')[0]?.trim() || '';
    marker = '학생이';
  } else {
    beforeNameMarker = stripKnownEventPhrases(compact);
  }

  if (!beforeNameMarker) {
    return { ok: false, error: '학생명을 찾을 수 없습니다.' };
  }

  // Web발신 SMS는 보통 "[Web발신]\n더플레이스26\n테스트 학생이..."처럼 오며,
  // compact 후에는 "더플레이스26 테스트"가 학생명 앞 prefix가 됩니다.
  const matchResult = matchStudentFromPrefix(beforeNameMarker, activeStudents);
  let matchedStudent = matchResult.matchedStudent;
  let parsedStudentName = matchResult.studentName;
  let academyName = '';

  if (matchedStudent) {
    academyName = compactMessage(beforeNameMarker.slice(0, beforeNameMarker.length - String(parsedStudentName).length));
  } else if (marker === '학생이') {
    // 학생명이 아직 매칭되지 않은 경우에도 "더플레이스26 테스트"에서 마지막 토큰을 학생명으로 추출합니다.
    const tokens = beforeNameMarker.split(/\s+/).filter(Boolean);
    parsedStudentName = tokens[tokens.length - 1] || beforeNameMarker;
    academyName = tokens.slice(0, -1).join(' ');
  } else {
    const tokens = beforeNameMarker.split(/\s+/).filter(Boolean);
    parsedStudentName = tokens[tokens.length - 1] || beforeNameMarker;
    academyName = tokens.slice(0, -1).join(' ');
  }

  const reason = (() => {
    const match = raw.match(/사유\s*[:：]\s*([^]+?)(?:\s+재원시간\s*[:：]|$)/);
    return match ? safeText(match[1]) : '';
  })();

  const duration = (() => {
    const match = raw.match(/재원시간\s*[:：]\s*(.+)$/);
    return match ? safeText(match[1]) : '';
  })();

  const eventTypeMap = {
    입실: 'check_in',
    외출: 'away',
    퇴실: 'check_out',
    재입장: 'return',
  };

  return {
    ok: true,
    rawText: originalRaw,
    koreanType,
    eventType: eventTypeMap[koreanType],
    academyName,
    studentName: parsedStudentName,
    reason,
    duration,
    matchedStudent,
  };
}

async function findSeatNoForStudent(supabase, student) {
  if (student?.default_seat_no) return Number(student.default_seat_no);

  const { data: seat } = await supabase
    .from('seats')
    .select('seat_no')
    .eq('current_student_id', student.id)
    .maybeSingle();

  if (seat?.seat_no) return Number(seat.seat_no);

  const today = getKstDateString();
  const { data: session } = await supabase
    .from('daily_sessions')
    .select('seat_no')
    .eq('student_id', student.id)
    .eq('session_date', today)
    .maybeSingle();

  return session?.seat_no ? Number(session.seat_no) : null;
}

async function updateImportEvent(supabase, id, patch = {}) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('attendance_import_events')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}


function getOperatorFriendlyKioskError(message = '') {
  const text = String(message || '').trim();
  if (!text) return '처리 실패 사유를 확인하세요.';
  if (/학생을 찾을 수 없습니다/.test(text)) return `${text} Beyond OS 학생명과 문자 학생명을 확인하세요.`;
  if (/학생명 중복/.test(text)) return `${text} 동명이인 학생은 이름 뒤 구분표시를 붙여 저장해야 합니다.`;
  if (/기본 좌석|좌석/.test(text) && /없|지정/.test(text)) return `${text} 학생 정보에서 좌석 배정을 확인하세요.`;
  if (/입실 기록/.test(text)) return `${text} 기존 좌석배치도에서 입실 상태를 먼저 확인하세요.`;
  if (/외출 상태/.test(text)) return `${text} 현재 출결 상태와 키오스크 문자가 맞는지 확인하세요.`;
  if (/이미 퇴실/.test(text)) return `${text} 중복 하원 문자 또는 수동 처리 여부를 확인하세요.`;
  if (/중복/.test(text)) return `${text} 같은 출결이 이미 처리된 것으로 보입니다.`;
  return text;
}

function validateKioskTransition(existingSession, eventType) {
  const hasCheckIn = Boolean(existingSession?.check_in_at);
  const hasCheckOut = Boolean(existingSession?.check_out_at);
  const isAway = Boolean(existingSession?.away_started_at) || existingSession?.seat_status === 'away';
  const isOccupied = existingSession?.seat_status === 'occupied' || (hasCheckIn && !hasCheckOut && !isAway);

  if (eventType === 'check_in') {
    if (isOccupied && !hasCheckOut) {
      return { ok: false, duplicate: true, status: 'duplicate', error: '이미 입실 상태입니다. 중복 입실 문자로 판단해 자동반영을 무시했습니다.' };
    }
    if (isAway) {
      return { ok: false, status: 'failed', error: '현재 외출 상태입니다. 복귀 문자는 “다시 돌아왔어요/재입장” 형식으로 수신되어야 합니다.' };
    }
    // 퇴실 후 다시 도착한 문자는 재입실로 허용합니다.
    return { ok: true };
  }

  if (eventType === 'away') {
    if (!hasCheckIn) return { ok: false, status: 'failed', error: '입실 기록이 없어 외출을 자동반영할 수 없습니다.' };
    // 퇴실 후 다시 키오스크를 찍은 외출 신호는 재입실 후 외출로 허용합니다.(퇴실~지금은 외출로 산정)
    if (hasCheckOut) return { ok: true };
    if (isAway) return { ok: false, duplicate: true, status: 'duplicate', error: '이미 외출 상태입니다. 중복 외출 문자로 판단해 자동반영을 무시했습니다.' };
    return { ok: true };
  }

  if (eventType === 'return') {
    if (!hasCheckIn) return { ok: false, status: 'failed', error: '입실 기록이 없어 복귀를 자동반영할 수 없습니다.' };
    // 퇴실 후 다시 돌아온 복귀 신호는 재입실로 허용합니다.(퇴실~복귀는 외출로 산정)
    if (hasCheckOut) return { ok: true };
    if (!isAway) return { ok: false, status: 'failed', error: '현재 외출 상태가 아니므로 복귀를 자동반영할 수 없습니다.' };
    return { ok: true };
  }

  if (eventType === 'check_out') {
    if (!hasCheckIn) return { ok: false, status: 'failed', error: '입실 기록이 없어 퇴실을 자동반영할 수 없습니다.' };
    if (hasCheckOut) return { ok: false, duplicate: true, status: 'duplicate', error: '이미 퇴실 상태입니다. 중복 하원 문자로 판단해 자동반영을 무시했습니다.' };
    return { ok: true };
  }

  return { ok: true };
}

async function findRecentManualConflict({ supabase, studentId, eventType, receivedAt, windowSeconds = DEFAULT_KIOSK_BRIDGE_SETTINGS.manualConflictWindowSeconds }) {
  if (!studentId || !eventType) return null;
  const seconds = Number(windowSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const receivedTime = new Date(receivedAt || Date.now()).getTime();
  if (!Number.isFinite(receivedTime)) return null;
  const sinceIso = new Date(receivedTime - seconds * 1000).toISOString();
  const untilIso = new Date(receivedTime + 5000).toISOString();
  const { data, error } = await supabase
    .from('attendance_events')
    .select('id, event_type, event_at, created_by, source_type, source_label, memo')
    .eq('student_id', studentId)
    .eq('event_type', eventType)
    .gte('event_at', sinceIso)
    .lte('event_at', untilIso)
    .order('event_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data || []).find((event) => {
    const source = String(event.source_type || '').toLowerCase();
    const createdBy = String(event.created_by || '').toLowerCase();
    if (source === KIOSK_SOURCE_TYPE || source === 'system' || createdBy === 'system' || isSystemAutoCheckoutEvent(event)) return false;
    return true;
  }) || null;
}

function buildSessionStateForEvent({ existingSession, eventType, nowIso }) {
  let awayTotalMinutes = Number(existingSession?.away_total_minutes || 0);
  let awayStartedAt = existingSession?.away_started_at || null;
  let checkInAt = existingSession?.check_in_at || null;
  let checkOutAt = existingSession?.check_out_at || null;
  let eventMemo = null;
  let seatStatus = eventTypeToSeatStatus(eventType);

  if (eventType === 'check_in') {
    const previousCheckout = checkOutAt;
    if (!checkInAt) checkInAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    }
    // 퇴실 후 재입실(하루 두 번째 등원): 퇴실~재입실 기간을 외출(자리비움)로 산정합니다.
    // (수동 재입실과 동일하게 순공시간에서 제외)
    if (previousCheckout) {
      awayTotalMinutes += diffMinutes(previousCheckout, nowIso);
      eventMemo = '퇴실 후 재입실 처리';
    }
    checkOutAt = null;
  }

  if (eventType === 'away') {
    const previousCheckout = checkOutAt;
    if (!checkInAt) checkInAt = nowIso;
    // 퇴실 후 재입실 → 외출: 퇴실~지금 기간을 외출(자리비움)로 산정한 뒤 지금부터 다시 외출 처리
    if (previousCheckout) {
      awayTotalMinutes += diffMinutes(previousCheckout, nowIso);
      eventMemo = '퇴실 후 재입실 외출 처리';
    }
    if (!awayStartedAt) awayStartedAt = nowIso;
    checkOutAt = null;
  }

  if (eventType === 'return') {
    const previousCheckout = checkOutAt;
    if (!checkInAt) checkInAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    } else if (previousCheckout) {
      // 퇴실 후 복귀(재입실): 퇴실~복귀 기간을 외출(자리비움)로 산정하고 재입실 처리
      awayTotalMinutes += diffMinutes(previousCheckout, nowIso);
      eventMemo = '퇴실 후 복귀(재입실) 처리';
    }
    checkOutAt = null;
    seatStatus = 'occupied';
  }

  if (eventType === 'check_out') {
    if (!checkInAt) checkInAt = nowIso;
    checkOutAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    }
  }

  return { checkInAt, checkOutAt, awayStartedAt, awayTotalMinutes, seatStatus, eventMemo };
}

async function applyAttendanceEvent({ supabase, student, seatNo, eventType, nowIso, memo, importEventId, defaultSchedule }) {
  const today = getKstDateString(new Date(nowIso));

  const { data: existingSession, error: existingError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', student.id)
    .eq('session_date', today)
    .maybeSingle();

  if (existingError) throw existingError;

  const next = buildSessionStateForEvent({ existingSession, eventType, nowIso });
  const pureStudyMinutes = calculateScheduledPureStudyMinutes({
    check_in_at: next.checkInAt,
    check_out_at: next.checkOutAt,
    away_started_at: next.awayStartedAt,
    away_total_minutes: next.awayTotalMinutes,
  }, { nowIso, studyWindows: defaultSchedule.studyWindows });

  const sessionPayload = {
    student_id: student.id,
    seat_no: seatNo,
    session_date: today,
    seat_status: next.seatStatus,
    check_in_at: next.checkInAt,
    check_out_at: next.checkOutAt,
    away_started_at: next.awayStartedAt,
    away_total_minutes: next.awayTotalMinutes,
    pure_study_minutes: pureStudyMinutes,
    pure_study_manual_text: null,
    attendance_memo: existingSession?.attendance_memo || null,
    current_study_status: existingSession?.current_study_status || null,
    current_subject: existingSession?.current_subject || null,
  };

  const { data: savedSession, error: sessionError } = await supabase
    .from('daily_sessions')
    .upsert(sessionPayload, { onConflict: 'student_id,session_date' })
    .select('*, students(*)')
    .single();

  if (sessionError) throw sessionError;

  await supabase.from('seats').update({ current_student_id: student.id }).eq('seat_no', seatNo);

  const eventPayload = {
    session_id: savedSession.id,
    student_id: student.id,
    seat_no: seatNo,
    event_type: eventType,
    event_at: nowIso,
    memo: memo || next.eventMemo || null,
    created_by: KIOSK_ACTOR,
    source_type: KIOSK_SOURCE_TYPE,
    source_label: KIOSK_SOURCE_LABEL,
    import_event_id: importEventId,
  };

  const { data: savedEvent, error: eventError } = await supabase
    .from('attendance_events')
    .insert(eventPayload)
    .select()
    .single();

  if (eventError) throw eventError;

  return { savedSession, savedEvent, pureStudyMinutes };
}

export async function POST(request) {
  const contentType = request.headers.get('content-type') || '';
  let body = {};
  let rawBodyText = '';

  try {
    rawBodyText = await request.text();
  } catch {
    rawBodyText = '';
  }

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      body = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch {
      body = {};
    }
  } else if (rawBodyText) {
    // v40-120: MacroDroid에서 SMS 본문 변수를 JSON 문자열 안에 넣으면 줄바꿈 때문에 JSON이 깨질 수 있습니다.
    // text/plain으로 원문만 보내면 서버가 rawText로 직접 수신합니다.
    body = {
      rawText: rawBodyText,
      sourceDeviceId: request.headers.get('x-source-device-id') || request.headers.get('x-device-id') || 'sms-bridge-phone-01',
      idempotencyKey: request.headers.get('x-idempotency-key') || '',
    };
  }

  const auth = assertBridgeAuthorized(request, body);
  if (!auth.ok) {
    return Response.json({
      ok: false,
      stage: 'auth',
      error: auth.error,
      hint: auth.status === 503
        ? 'Vercel 환경변수 KIOSK_BRIDGE_SECRET을 추가한 뒤 Production 재배포가 필요합니다.'
        : '자동화 앱의 x-kiosk-secret 값이 Vercel의 KIOSK_BRIDGE_SECRET과 같은지 확인하세요.',
    }, { status: auth.status });
  }

  const supabase = getSupabaseAdmin();
  let importEvent = null;

  try {
    const diagnostics = await checkKioskBridgeReadiness(supabase);
    if (!diagnostics.ok) {
      return Response.json({
        ok: false,
        stage: 'schema_check',
        error: '키오스크 브릿지 SQL 점검에 실패했습니다.',
        hint: 'beyond-os-supabase-kiosk-bridge-v40-115.sql 전체가 실행되었는지 확인하세요.',
        diagnostics,
      }, { status: 500 });
    }

    const defaultSchedule = await getDefaultScheduleSettings(supabase, getKstDateString());
    const bridgeSettings = await getKioskBridgeSettings(supabase);
    const rawText = getRawText(body);
    const sourceDeviceId = safeText(body.sourceDeviceId || body.deviceId || request.headers.get('x-source-device-id') || request.headers.get('x-device-id') || 'android-bridge');
    const receivedAt = (body.receivedAt || request.headers.get('x-received-at')) ? new Date(body.receivedAt || request.headers.get('x-received-at')).toISOString() : new Date().toISOString();
    const idempotencyKey = makeIdempotencyKey({
      rawText,
      sourceDeviceId,
      receivedAt,
      explicitKey: body.idempotencyKey || request.headers.get('x-idempotency-key'),
    });

    if (!rawText) {
      return Response.json({
        ok: false,
        stage: 'input',
        error: '알림 원문이 비어 있습니다.',
        hint: 'MacroDroid Body의 rawText에 알림 본문 매직텍스트가 들어가야 합니다.',
      }, { status: 400 });
    }

    const { data: existingImport, error: existingImportError } = await supabase
      .from('attendance_import_events')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingImportError) {
      return buildKioskErrorResponse({ status: 500, stage: 'duplicate_check', error: existingImportError, fallbackMessage: '중복 알림 점검 중 오류가 발생했습니다.' });
    }

    if (['processed', 'heartbeat', 'held'].includes(existingImport?.status)) {
      return Response.json({
        ok: true,
        duplicate: true,
        status: existingImport.status,
        importEvent: existingImport,
        message: existingImport.status === 'heartbeat' ? '이미 수신된 키오스크 Heartbeat입니다.' : (existingImport.status === 'held' ? '이미 쉬는 시간 HOLD 목록에 보관된 키오스크 알림입니다.' : '이미 처리된 키오스크 알림입니다.'),
      });
    }

    if (isHeartbeatPayload(body, rawText)) {
      const heartbeatPayload = {
        source: 'kiosk_heartbeat',
        source_device_id: sourceDeviceId,
        idempotency_key: idempotencyKey,
        raw_text: rawText || 'KIOSK_HEARTBEAT',
        parsed_event_type: 'heartbeat',
        parsed_academy_name: null,
        parsed_student_name: null,
        parsed_reason: null,
        parsed_duration: null,
        status: 'heartbeat',
        error_message: null,
        received_at: receivedAt,
        processed_at: new Date().toISOString(),
      };
      const result = await saveImportLogSafe(supabase, existingImport, heartbeatPayload, idempotencyKey);
      if (result.error) {
        return buildKioskErrorResponse({
          status: 500,
          stage: 'heartbeat_log_save',
          error: result.error,
          fallbackMessage: '키오스크 Heartbeat 저장 중 오류가 발생했습니다.',
        });
      }
      return Response.json({
        ok: true,
        heartbeat: true,
        status: 'heartbeat',
        sourceDeviceId,
        importEvent: result.data,
        message: '키오스크 브릿지 Heartbeat가 정상 수신되었습니다.',
        toastMessage: '키오스크 브릿지 Heartbeat가 정상 수신되었습니다.',
      });
    }

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('*')
      .neq('status', 'inactive')
      .order('name', { ascending: true });
    if (studentsError) {
      return buildKioskErrorResponse({ status: 500, stage: 'students_query', error: studentsError, fallbackMessage: '학생 목록 조회 중 오류가 발생했습니다.' });
    }

    const aliasResult = await loadKioskStudentAliases(supabase);
    const kioskStudentAliases = aliasResult.aliases || [];

    const parsed = parseKioskAlimtalk(rawText, students || []);

    const importPayload = {
      source: 'kiosk_alimtalk',
      source_device_id: sourceDeviceId,
      idempotency_key: idempotencyKey,
      raw_text: rawText,
      parsed_event_type: parsed.ok ? parsed.eventType : null,
      parsed_academy_name: parsed.ok ? parsed.academyName : null,
      parsed_student_name: parsed.ok ? parsed.studentName : null,
      parsed_reason: parsed.ok ? parsed.reason : null,
      parsed_duration: parsed.ok ? parsed.duration : null,
      status: parsed.ok ? 'parsed' : 'failed',
      error_message: parsed.ok ? null : parsed.error,
      received_at: receivedAt,
    };

    // v40-119: 기존 v40-115 SQL의 idempotency_key unique index가 partial index인 경우
    // Supabase/PostgREST upsert(onConflict)가 42P10 오류를 낼 수 있어,
    // upsert 대신 select → update/insert 방식으로 안전하게 저장합니다.
    const importResult = await saveImportLogSafe(supabase, existingImport, importPayload, idempotencyKey);
    const savedImportEvent = importResult.data;
    const importError = importResult.error;
    if (importResult.duplicate && savedImportEvent) {
      return Response.json({
        ok: true,
        duplicate: true,
        status: savedImportEvent.status,
        importEvent: savedImportEvent,
        message: savedImportEvent.status === 'processed'
          ? '이미 처리된 키오스크 알림입니다.'
          : savedImportEvent.status === 'heartbeat'
            ? '이미 수신된 키오스크 Heartbeat입니다.'
            : '이미 수신된 키오스크 알림입니다. 처리 상태를 확인하세요.',
      });
    }

    if (importError) {
      return buildKioskErrorResponse({
        status: 500,
        stage: 'import_log_save',
        error: importError,
        fallbackMessage: '키오스크 알림 수신 로그 저장 중 오류가 발생했습니다.',
        extra: { hint: 'v40-119에서는 ON CONFLICT upsert를 사용하지 않습니다. attendance_import_events 테이블 컬럼과 RLS/권한을 확인하세요.' },
      });
    }
    importEvent = savedImportEvent;

    if (!parsed.ok) {
      return Response.json({ ok: false, stage: 'parse', error: parsed.error, rawText, importEvent }, { status: 400 });
    }

    if (bridgeSettings.autoApplyEnabled === false) {
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'pending',
        error_message: '키오스크 자동반영 OFF 상태라 출결 반영 없이 로그만 저장했습니다.',
        processed_at: new Date().toISOString(),
      });
      return Response.json({
        ok: true,
        autoApplied: false,
        stage: 'auto_apply_disabled',
        status: 'pending',
        source: KIOSK_SOURCE_LABEL,
        eventType: parsed.eventType,
        koreanType: parsed.koreanType,
        studentName: parsed.studentName,
        importEvent: updated,
        toastMessage: `${parsed.studentName || '학생'} ${parsed.koreanType || '출결'} 문자가 수신되었지만, 키오스크 자동반영 OFF 상태라 로그만 저장되었습니다.`,
      });
    }

    let student = parsed.matchedStudent || findStudentByAlias(parsed.studentName, kioskStudentAliases, students || []);
    if (!student) {
      const exactMatches = (students || []).filter((item) => String(item.name || '').trim() === parsed.studentName);
      if (exactMatches.length === 1) student = exactMatches[0];
      if (exactMatches.length > 1) {
        const updated = await updateImportEvent(supabase, importEvent.id, {
          status: 'failed',
          error_message: getOperatorFriendlyKioskError(`학생명 중복: ${parsed.studentName}`),
          processed_at: new Date().toISOString(),
        });
        return Response.json({ ok: false, stage: 'student_match', error: updated.error_message, importEvent: updated }, { status: 409 });
      }
    }

    if (!student) {
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'failed',
        error_message: getOperatorFriendlyKioskError(`학생을 찾을 수 없습니다: ${parsed.studentName}`),
        processed_at: new Date().toISOString(),
      });
      return Response.json({
        ok: false,
        stage: 'student_match',
        error: updated.error_message,
        hint: '알림톡의 학생명과 Beyond OS 활성 학생명이 정확히 일치해야 합니다.',
        parsedStudentName: parsed.studentName,
        importEvent: updated,
      }, { status: 404 });
    }

    const today = getKstDateString(new Date(receivedAt));
    const { data: currentSession, error: currentSessionError } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('student_id', student.id)
      .eq('session_date', today)
      .maybeSingle();
    if (currentSessionError) {
      return buildKioskErrorResponse({ status: 500, stage: 'current_session_check', error: currentSessionError, fallbackMessage: '현재 출결 상태 확인 중 오류가 발생했습니다.' });
    }

    const manualConflictWindowSeconds = bridgeSettings.manualConflictWindowSeconds ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.manualConflictWindowSeconds;
    const manualConflict = await findRecentManualConflict({ supabase, studentId: student.id, eventType: parsed.eventType, receivedAt, windowSeconds: manualConflictWindowSeconds });
    if (manualConflict) {
      const friendlyMessage = getOperatorFriendlyKioskError(`관리자 수동 처리 후 ${manualConflictWindowSeconds}초 이내 동일한 키오스크 문자가 들어와 중복으로 무시했습니다.`);
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'duplicate',
        student_id: student.id,
        error_message: friendlyMessage,
        processed_at: new Date().toISOString(),
      });
      return Response.json({
        ok: true,
        duplicate: true,
        stage: 'manual_conflict_guard',
        status: 'duplicate',
        eventType: parsed.eventType,
        koreanType: parsed.koreanType,
        studentName: student.name,
        manualEvent: manualConflict,
        importEvent: updated,
        toastMessage: `${student.name} 학생 ${parsed.koreanType} 문자는 최근 관리자 수동 처리와 중복되어 자동반영하지 않았습니다.`,
      });
    }


    // 그 날 아직 출결 기록이 없는 학생의 첫 등원(입실)은 쉬는 시간이라도 HOLD로 보내지 않고 바로 반영합니다.
    const isFirstCheckIn = parsed.eventType === 'check_in' && !currentSession?.check_in_at;
    const breakHoldWindow = (shouldHoldBreakSignal(parsed.eventType) && !isFirstCheckIn)
      ? getBreakHoldWindow(receivedAt, defaultSchedule.studyWindows, bridgeSettings.breakHoldBufferMinutes)
      : null;
    if (breakHoldWindow) {
      const duplicateWindowSeconds = bridgeSettings.breakHoldDuplicateWindowSeconds ?? DEFAULT_KIOSK_BRIDGE_SETTINGS.breakHoldDuplicateWindowSeconds;
      const recentDuplicateHold = await findRecentDuplicateBreakHold({
        supabase,
        studentId: student.id,
        eventType: parsed.eventType,
        receivedAt,
        windowSeconds: duplicateWindowSeconds,
        breakWindow: breakHoldWindow,
      });
      if (recentDuplicateHold) {
        const friendlyMessage = `같은 학생의 동일한 ${parsed.koreanType} 신호가 ${duplicateWindowSeconds}초 안에 반복되어 중복으로 무시했습니다.`;
        const updated = await updateImportEvent(supabase, importEvent.id, {
          status: 'duplicate',
          student_id: student.id,
          session_id: currentSession?.id || null,
          seat_no: currentSession?.seat_no || student.default_seat_no || null,
          error_message: friendlyMessage,
          operator_action: 'break_hold_duplicate',
          operator_memo: `기존 HOLD ${recentDuplicateHold.id}`,
          processed_at: new Date().toISOString(),
        });
        return Response.json({
          ok: true,
          duplicate: true,
          stage: 'break_hold_duplicate_guard',
          status: 'duplicate',
          eventType: parsed.eventType,
          koreanType: parsed.koreanType,
          studentName: student.name,
          duplicateHold: recentDuplicateHold,
          importEvent: updated,
          toastMessage: `${student.name} 학생 ${parsed.koreanType} 신호는 ${duplicateWindowSeconds}초 내 중복으로 HOLD 목록에 추가하지 않았습니다.`,
        });
      }

      const seatNo = await findSeatNoForStudent(supabase, student);
      const { data: holdRow, error: holdError } = await supabase
        .from('kiosk_attendance_holds')
        .insert({
          import_event_id: importEvent.id,
          student_id: student.id,
          session_id: currentSession?.id || null,
          seat_no: seatNo || currentSession?.seat_no || null,
          event_type: parsed.eventType,
          event_at: receivedAt,
          raw_text: rawText,
          parsed_reason: parsed.reason || null,
          hold_reason: 'break_window',
          break_label: `${breakHoldWindow.previousLabel} 종료 후 ~ ${breakHoldWindow.nextLabel} 시작 전`,
          break_start_time: breakHoldWindow.startTime,
          break_end_time: breakHoldWindow.endTime,
          status: 'pending',
        })
        .select('*, students(name, grade, school)')
        .single();
      if (holdError) throw holdError;

      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'held',
        student_id: student.id,
        session_id: currentSession?.id || null,
        seat_no: seatNo || currentSession?.seat_no || null,
        error_message: `쉬는 시간 신호 HOLD (${breakHoldWindow.startTime}~${breakHoldWindow.endTime})`,
        processed_at: new Date().toISOString(),
      });

      return Response.json({
        ok: true,
        held: true,
        status: 'held',
        eventType: parsed.eventType,
        koreanType: parsed.koreanType,
        studentName: student.name,
        hold: holdRow,
        importEvent: updated,
        toastMessage: `${student.name} 학생 ${parsed.koreanType} 신호를 쉬는 시간 HOLD 목록에 보관했습니다.`,
      });
    }

    if (parsed.eventType === 'check_out' && !currentSession?.check_in_at) {
      const overnightCandidate = await findOvernightCheckoutCandidate({
        supabase,
        studentId: student.id,
        receivedAt,
        settings: bridgeSettings,
      });

      if (overnightCandidate?.duplicate) {
        const friendlyMessage = getOperatorFriendlyKioskError(overnightCandidate.reason || '자정 이후 실제 퇴실이 이미 처리되어 중복으로 무시했습니다.');
        const updated = await updateImportEvent(supabase, importEvent.id, {
          status: 'duplicate',
          student_id: student.id,
          session_id: overnightCandidate.session?.id || null,
          attendance_event_id: overnightCandidate.existingEvent?.id || null,
          seat_no: overnightCandidate.session?.seat_no || null,
          error_message: friendlyMessage,
          processed_at: new Date().toISOString(),
        });
        return Response.json({
          ok: true,
          duplicate: true,
          stage: 'overnight_checkout_duplicate_guard',
          status: 'duplicate',
          overnightCheckoutCorrection: true,
          eventType: parsed.eventType,
          koreanType: parsed.koreanType,
          studentName: student.name,
          sessionDate: overnightCandidate.previousDate,
          importEvent: updated,
          attendanceEvent: overnightCandidate.existingEvent,
          toastMessage: `${student.name} 학생의 자정 이후 실제 퇴실 문자는 이미 전날 세션에 보정되어 중복으로 무시했습니다.`,
        });
      }

      if (overnightCandidate?.session?.id) {
        const corrected = await applyOvernightCheckoutCorrection({
          supabase,
          student,
          candidate: overnightCandidate,
          receivedAt,
          importEventId: importEvent.id,
          defaultSchedule,
        });

        const updated = await updateImportEvent(supabase, importEvent.id, {
          status: 'processed',
          student_id: student.id,
          session_id: corrected.savedSession.id,
          attendance_event_id: corrected.savedEvent.id,
          seat_no: corrected.savedSession.seat_no || null,
          processed_at: new Date().toISOString(),
          error_message: null,
        });

        let attendanceNotificationResult = null;
        try {
          attendanceNotificationResult = await sendAttendanceNotification({
            supabase,
            request,
            attendanceEvent: corrected.savedEvent,
            session: corrected.savedSession,
            student,
            sourceType: KIOSK_SOURCE_TYPE,
            sourceLabel: '키오스크 자동기록',
            createdBy: KIOSK_ACTOR,
          });
        } catch (notificationError) {
          attendanceNotificationResult = { ok: false, error: notificationError.message || '출결 자동 알림 처리 실패' };
        }

        return Response.json({
          ok: true,
          source: KIOSK_SOURCE_LABEL,
          overnightCheckoutCorrection: true,
          eventType: parsed.eventType,
          koreanType: parsed.koreanType,
          studentName: student.name,
          seatNo: corrected.savedSession.seat_no,
          sessionDate: corrected.previousDate,
          session: corrected.savedSession,
          attendanceEvent: corrected.savedEvent,
          attendanceNotification: attendanceNotificationResult,
          importEvent: updated,
          toastMessage: `${student.name} 학생의 자정 이후 실제 퇴실을 ${corrected.previousDate} 세션 퇴실로 보정하고 알림을 발송했습니다.`,
        });
      }
    }

    const transition = validateKioskTransition(currentSession, parsed.eventType);
    if (!transition.ok) {
      const friendlyMessage = getOperatorFriendlyKioskError(transition.error);
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: transition.status || 'failed',
        student_id: student.id,
        error_message: friendlyMessage,
        processed_at: new Date().toISOString(),
      });
      return Response.json({
        ok: transition.duplicate ? true : false,
        duplicate: Boolean(transition.duplicate),
        stage: transition.duplicate ? 'state_duplicate_guard' : 'state_transition_guard',
        status: transition.status || 'failed',
        eventType: parsed.eventType,
        koreanType: parsed.koreanType,
        studentName: student.name,
        error: friendlyMessage,
        importEvent: updated,
        toastMessage: transition.duplicate
          ? `${student.name} 학생 ${parsed.koreanType} 문자는 현재 상태와 중복되어 자동반영하지 않았습니다.`
          : `${student.name} 학생 ${parsed.koreanType} 자동반영 실패: ${friendlyMessage}`,
      }, { status: transition.duplicate ? 200 : 409 });
    }

    const seatNo = await findSeatNoForStudent(supabase, student);
    if (!seatNo) {
      const friendlyMessage = getOperatorFriendlyKioskError(`${student.name} 학생의 기본 좌석이 없습니다. 학생 정보에서 좌석을 지정하세요.`);
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'failed',
        student_id: student.id,
        error_message: friendlyMessage,
        processed_at: new Date().toISOString(),
      });
      return Response.json({ ok: false, stage: 'seat_match', error: updated.error_message, importEvent: updated }, { status: 409 });
    }

    const eventMemo = parsed.eventType === 'away' && parsed.reason ? parsed.reason : null;

    const applied = await applyAttendanceEvent({
      supabase,
      student,
      seatNo,
      eventType: parsed.eventType,
      nowIso: receivedAt,
      memo: eventMemo,
      importEventId: importEvent.id,
      defaultSchedule,
    });

    const updated = await updateImportEvent(supabase, importEvent.id, {
      status: 'processed',
      student_id: student.id,
      session_id: applied.savedSession.id,
      attendance_event_id: applied.savedEvent.id,
      seat_no: seatNo,
      processed_at: new Date().toISOString(),
      error_message: null,
    });

    let attendanceNotificationResult = null;
    try {
      attendanceNotificationResult = await sendAttendanceNotification({
        supabase,
        request,
        attendanceEvent: applied.savedEvent,
        session: applied.savedSession,
        student,
        sourceType: KIOSK_SOURCE_TYPE,
        sourceLabel: '키오스크 자동기록',
        createdBy: KIOSK_ACTOR,
      });
    } catch (notificationError) {
      attendanceNotificationResult = { ok: false, error: notificationError.message || '출결 자동 알림 처리 실패' };
    }

    return Response.json({
      ok: true,
      source: KIOSK_SOURCE_LABEL,
      eventType: parsed.eventType,
      koreanType: parsed.koreanType,
      studentName: student.name,
      seatNo,
      session: applied.savedSession,
      attendanceEvent: applied.savedEvent,
      attendanceNotification: attendanceNotificationResult,
      importEvent: updated,
      toastMessage: `${student.name} 학생 ${parsed.koreanType}이 키오스크를 통해 자동 반영되었습니다.`,
    });
  } catch (error) {
    try {
      if (importEvent?.id) {
        const updated = await updateImportEvent(supabase, importEvent.id, {
          status: 'failed',
          error_message: error.message || '키오스크 출결 반영 중 오류가 발생했습니다.',
          processed_at: new Date().toISOString(),
        });
        return buildKioskErrorResponse({
          status: 500,
          stage: 'apply_attendance',
          error,
          fallbackMessage: updated.error_message,
          extra: { importEvent: updated },
        });
      }
    } catch {}
    return buildKioskErrorResponse({ status: 500, stage: 'unhandled', error, fallbackMessage: '키오스크 브릿지 처리 중 알 수 없는 오류가 발생했습니다.' });
  }
}
