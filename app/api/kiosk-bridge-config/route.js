import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { checkKioskBridgeReadiness } from '../../../lib/kioskBridgeDiagnostics';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';


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

async function saveKioskBridgeSettings(supabase, settings) {
  const normalized = normalizeKioskBridgeSettings(settings);
  const { data, error } = await supabase
    .from('system_settings')
    .upsert({
      setting_key: KIOSK_BRIDGE_SETTINGS_KEY,
      setting_value: normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    .select('setting_value')
    .single();
  if (error) throw error;
  return normalizeKioskBridgeSettings(data?.setting_value || normalized);
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getKstMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function isWithinOperatingHours(settings = {}) {
  if (settings.operatingHoursEnabled === false) return true;
  const start = timeToMinutes(settings.operationStartTime || DEFAULT_KIOSK_BRIDGE_SETTINGS.operationStartTime);
  const end = timeToMinutes(settings.operationEndTime || DEFAULT_KIOSK_BRIDGE_SETTINGS.operationEndTime);
  const now = getKstMinutesNow();
  if (start === null || end === null) return true;
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function latestIso(...values) {
  return values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() || null;
}

function buildStaleStatus(operationSummary, settings) {
  const thresholdMinutes = Number(settings?.staleWarningMinutes || DEFAULT_KIOSK_BRIDGE_SETTINGS.staleWarningMinutes);
  const insideOperatingHours = isWithinOperatingHours(settings);
  const lastSignalAt = operationSummary?.lastSignalAt || latestIso(operationSummary?.lastReceivedAt, operationSummary?.lastHeartbeatAt, operationSummary?.lastAttendanceReceivedAt);
  const lastHeartbeatAt = operationSummary?.lastHeartbeatAt || null;
  const lastAttendanceReceivedAt = operationSummary?.lastAttendanceReceivedAt || null;
  const base = {
    thresholdMinutes,
    operatingHoursEnabled: settings?.operatingHoursEnabled !== false,
    operationStartTime: settings?.operationStartTime || DEFAULT_KIOSK_BRIDGE_SETTINGS.operationStartTime,
    operationEndTime: settings?.operationEndTime || DEFAULT_KIOSK_BRIDGE_SETTINGS.operationEndTime,
    insideOperatingHours,
    lastSignalAt,
    lastHeartbeatAt,
    lastAttendanceReceivedAt,
    minutesSinceLastSignal: null,
    minutesSinceLastHeartbeat: null,
    minutesSinceLastAttendance: null,
  };

  const now = Date.now();
  const calcElapsed = (value) => {
    if (!value) return null;
    const elapsed = Math.floor((now - new Date(value).getTime()) / 60000);
    return Number.isFinite(elapsed) ? elapsed : null;
  };
  base.minutesSinceLastSignal = calcElapsed(lastSignalAt);
  base.minutesSinceLastHeartbeat = calcElapsed(lastHeartbeatAt);
  base.minutesSinceLastAttendance = calcElapsed(lastAttendanceReceivedAt);

  if (!insideOperatingHours) {
    return {
      ...base,
      stale: false,
      status: 'outside_hours',
      message: `현재는 운영시간(${base.operationStartTime}~${base.operationEndTime}) 밖이라 미수신 경고를 표시하지 않습니다.`,
    };
  }

  if (!lastSignalAt) {
    return {
      ...base,
      stale: true,
      status: 'no_signal',
      message: '운영시간 중 키오스크 수신/Heartbeat 기록이 없습니다. 브릿지폰/MacroDroid 상태를 확인하세요.',
    };
  }

  const stale = base.minutesSinceLastSignal !== null && base.minutesSinceLastSignal >= thresholdMinutes;
  return {
    ...base,
    stale,
    status: stale ? 'stale' : lastHeartbeatAt && (!lastAttendanceReceivedAt || new Date(lastHeartbeatAt) > new Date(lastAttendanceReceivedAt)) ? 'heartbeat_only' : 'normal',
    message: stale
      ? `최근 ${thresholdMinutes}분 이상 키오스크 수신/Heartbeat 기록이 없습니다. 브릿지폰/MacroDroid 상태를 확인하세요.`
      : lastHeartbeatAt && (!lastAttendanceReceivedAt || new Date(lastHeartbeatAt) > new Date(lastAttendanceReceivedAt))
        ? '출결 문자는 없지만 브릿지폰 Heartbeat가 정상 수신되고 있습니다.'
        : '최근 키오스크 수신 기록이 정상 범위 안에 있습니다.',
  };
}

function getBaseUrl(request) {
  const envUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return host ? `${proto}://${host}` : '';
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const baseUrl = getBaseUrl(request);
  const endpointPath = '/api/kiosk-attendance-bridge';
  const endpointUrl = baseUrl ? `${baseUrl}${endpointPath}` : endpointPath;
  const supabase = getSupabaseAdmin();
  const diagnostics = await checkKioskBridgeReadiness(supabase);
  const secretConfigured = Boolean(process.env.KIOSK_BRIDGE_SECRET);
  const bridgeSettings = await getKioskBridgeSettings(supabase);

  let recentImports = [];
  let recentImportsError = null;
  try {
    const baseQuery = () => supabase
      .from('attendance_import_events')
      .select('id, source, source_device_id, idempotency_key, raw_text, parsed_event_type, parsed_academy_name, parsed_student_name, parsed_reason, parsed_duration, student_id, session_id, attendance_event_id, seat_no, status, error_message, received_at, processed_at, created_at')
      .order('received_at', { ascending: false })
      .limit(50);
    const extendedQuery = () => supabase
      .from('attendance_import_events')
      .select('id, source, source_device_id, idempotency_key, raw_text, parsed_event_type, parsed_academy_name, parsed_student_name, parsed_reason, parsed_duration, student_id, session_id, attendance_event_id, seat_no, status, error_message, received_at, processed_at, created_at, operator_action, operator_memo, resolved_at, linked_import_event_id')
      .order('received_at', { ascending: false })
      .limit(50);

    const { data, error } = await extendedQuery();
    if (error) {
      const fallback = await baseQuery();
      if (fallback.error) recentImportsError = fallback.error.message || String(fallback.error);
      else {
        recentImports = fallback.data || [];
        recentImportsError = `${error.message || String(error)} / v41-05 SQL을 실행하면 관리자 재처리 컬럼까지 표시됩니다.`;
      }
    } else recentImports = data || [];
  } catch (error) {
    recentImportsError = error?.message || String(error);
  }

  let todayImports = [];
  let operationSummary = { total: 0, processed: 0, failed: 0, duplicate: 0, pending: 0, ignored: 0, reprocessed: 0, heartbeat: 0, successRate: 0, lastReceivedAt: null, lastProcessedAt: null, lastHeartbeatAt: null, lastAttendanceReceivedAt: null, lastSignalAt: null };
  try {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('attendance_import_events')
      .select('id, source, parsed_event_type, status, received_at, processed_at, created_at, operator_action')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(500);
    if (!error) {
      const today = getKstDateString();
      todayImports = (data || []).filter((item) => getKstDateString(new Date(item.received_at || item.created_at || Date.now())) === today);
      operationSummary = todayImports.reduce((acc, item) => {
        const status = String(item?.status || 'unknown').toLowerCase();
        acc.total += 1;
        const received = item.received_at || item.created_at || null;
        const isHeartbeat = status === 'heartbeat' || String(item?.source || '').toLowerCase() === 'kiosk_heartbeat' || String(item?.parsed_event_type || '').toLowerCase() === 'heartbeat';
        if (status === 'processed') acc.processed += 1;
        else if (status === 'failed') acc.failed += 1;
        else if (status === 'duplicate') acc.duplicate += 1;
        else if (status === 'ignored') acc.ignored = (acc.ignored || 0) + 1;
        else if (status === 'reprocessed') acc.reprocessed = (acc.reprocessed || 0) + 1;
        else if (isHeartbeat) acc.heartbeat += 1;
        else acc.pending += 1;
        if (!acc.lastReceivedAt || new Date(received || 0) > new Date(acc.lastReceivedAt || 0)) acc.lastReceivedAt = received;
        if (isHeartbeat && (!acc.lastHeartbeatAt || new Date(received || 0) > new Date(acc.lastHeartbeatAt || 0))) acc.lastHeartbeatAt = received;
        if (!isHeartbeat && (!acc.lastAttendanceReceivedAt || new Date(received || 0) > new Date(acc.lastAttendanceReceivedAt || 0))) acc.lastAttendanceReceivedAt = received;
        if (item.processed_at && (!acc.lastProcessedAt || new Date(item.processed_at) > new Date(acc.lastProcessedAt || 0))) acc.lastProcessedAt = item.processed_at;
        return acc;
      }, { total: 0, processed: 0, failed: 0, duplicate: 0, pending: 0, ignored: 0, reprocessed: 0, heartbeat: 0, successRate: 0, lastReceivedAt: null, lastProcessedAt: null, lastHeartbeatAt: null, lastAttendanceReceivedAt: null, lastSignalAt: null });
      operationSummary.lastSignalAt = latestIso(operationSummary.lastHeartbeatAt, operationSummary.lastAttendanceReceivedAt, operationSummary.lastReceivedAt);
      const actionableTotal = operationSummary.processed + operationSummary.failed + operationSummary.duplicate + operationSummary.pending;
      operationSummary.successRate = actionableTotal > 0 ? Math.round((operationSummary.processed / actionableTotal) * 100) : 0;
    }
  } catch {
    // 운영 요약은 진단 보조용이므로 실패해도 설정 화면 전체를 막지 않습니다.
  }


  let activeStudents = [];
  let activeStudentsError = null;
  try {
    const { data, error } = await supabase
      .from('students')
      .select('id, name, school, grade, status, default_seat_no')
      .neq('status', 'inactive')
      .order('name', { ascending: true });
    if (error) activeStudentsError = error.message || String(error);
    else activeStudents = data || [];
  } catch (error) {
    activeStudentsError = error?.message || String(error);
  }

  let studentAliases = [];
  let studentAliasesError = null;
  try {
    const { data, error } = await supabase
      .from('kiosk_student_aliases')
      .select('id, alias_name, student_id, source, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false });
    if (error) studentAliasesError = error.message || String(error);
    else studentAliases = (data || []).map((alias) => ({
      ...alias,
      student: (activeStudents || []).find((student) => student.id === alias.student_id) || null,
    }));
  } catch (error) {
    studentAliasesError = error?.message || String(error);
  }

  const staleStatus = buildStaleStatus(operationSummary, bridgeSettings);

  return Response.json({
    ok: true,
    endpointPath,
    endpointUrl,
    secretHeaderName: 'x-kiosk-secret',
    authorizationHeaderExample: 'Authorization: Bearer KIOSK_BRIDGE_SECRET',
    secretConfigured,
    diagnostics,
    recentImports,
    recentImportsError,
    operationSummary,
    bridgeSettings,
    activeStudents,
    activeStudentsError,
    studentAliases,
    studentAliasesError,
    staleStatus,
    sourceDeviceIdExample: 'sms-bridge-phone-01',
    sampleMessages: {
      checkIn: '[Web발신]\n더플레이스26\n김민준 학생이 학원에 도착했어요.',
      away: '[Web발신]\n더플레이스26\n김민준 학생이 잠시 외출했어요.\n 사유: 타학원 수업',
      checkOut: '[Web발신]\n더플레이스26\n김민준 학생이 하원했어요.\n 재원시간: 09시00분 ~ 21시50분',
      return: '[Web발신]\n더플레이스26\n김민준 학생이 다시 돌아왔어요.',
      heartbeat: 'KIOSK_HEARTBEAT',
    },
    jsonBodyTemplate: {
      rawText: '[Web발신]\n더플레이스26\n김민준 학생이 학원에 도착했어요.',
      sourceDeviceId: 'sms-bridge-phone-01',
      idempotencyKey: '알림마다_고유한_값_권장',
    },
    note: 'KIOSK_BRIDGE_SECRET 실제 값은 보안상 표시하지 않습니다. 문자 출결 매크로는 Content-Type text/plain + SMS 본문 매직텍스트를 Body에 그대로 넣고, Heartbeat 매크로는 text/plain Body에 KIOSK_HEARTBEAT만 넣는 방식을 권장합니다.',
  });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();
    const settings = await saveKioskBridgeSettings(supabase, body.bridgeSettings || body.settings || body || {});
    return Response.json({ ok: true, bridgeSettings: settings, saved: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: `${error.message || '키오스크 브릿지 설정 저장 실패'} / Supabase에서 beyond-os-supabase-operating-rules-v40-6.sql의 system_settings 테이블이 필요합니다.`,
    }, { status: 500 });
  }
}

