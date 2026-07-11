// Beyond OS v41-09
// 리포트/출결 알림 발송 설정 중, 운영자가 화면에서 직접 전환해야 하는 값은 system_settings에 저장합니다.
// 환경변수는 기본값으로 남기되, 대시보드에서 저장한 값이 있으면 그 값을 우선합니다.

export const REPORT_SEND_SETTINGS_KEY = 'report_send_settings';

export const DEFAULT_ATTENDANCE_NOTIFICATION_SETTINGS = {
  checkInEnabled: true,
  checkOutEnabled: true,
  awayEnabled: false,
  returnEnabled: false,
  returnOverdueEnabled: true,
  returnOverdueGraceMinutes: 15,
};

export const DEFAULT_REPORT_SEND_SETTINGS = {
  // null이면 기존 환경변수 KAKAO_RECIPIENT_TEST_MODE 값을 따릅니다.
  // true/false로 저장되면 대시보드 설정값이 환경변수보다 우선합니다.
  recipientTestMode: null,
  attendanceNotifications: DEFAULT_ATTENDANCE_NOTIFICATION_SETTINGS,
};

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(raw)) return true;
    if (['false', '0', 'off', 'no'].includes(raw)) return false;
  }
  return fallback;
}

export function normalizeAttendanceNotificationSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallback = DEFAULT_ATTENDANCE_NOTIFICATION_SETTINGS;
  const grace = Number(source.returnOverdueGraceMinutes ?? source.return_overdue_grace_minutes ?? fallback.returnOverdueGraceMinutes);
  return {
    checkInEnabled: normalizeBoolean(source.checkInEnabled ?? source.check_in_enabled, fallback.checkInEnabled),
    checkOutEnabled: normalizeBoolean(source.checkOutEnabled ?? source.check_out_enabled, fallback.checkOutEnabled),
    awayEnabled: normalizeBoolean(source.awayEnabled ?? source.away_enabled, fallback.awayEnabled),
    returnEnabled: normalizeBoolean(source.returnEnabled ?? source.return_enabled, fallback.returnEnabled),
    returnOverdueEnabled: normalizeBoolean(source.returnOverdueEnabled ?? source.return_overdue_enabled, fallback.returnOverdueEnabled),
    returnOverdueGraceMinutes: Number.isFinite(grace) && grace >= 0 ? Math.min(180, Math.round(grace)) : fallback.returnOverdueGraceMinutes,
  };
}

export function normalizeReportSendSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  let recipientTestMode = source.recipientTestMode ?? source.recipient_test_mode ?? DEFAULT_REPORT_SEND_SETTINGS.recipientTestMode;
  if (recipientTestMode !== true && recipientTestMode !== false) recipientTestMode = null;
  return {
    recipientTestMode,
    attendanceNotifications: normalizeAttendanceNotificationSettings(source.attendanceNotifications ?? source.attendance_notifications ?? DEFAULT_ATTENDANCE_NOTIFICATION_SETTINGS),
  };
}

export function resolveRecipientTestMode(settings = DEFAULT_REPORT_SEND_SETTINGS, envDefault = false) {
  const normalized = normalizeReportSendSettings(settings);
  return normalized.recipientTestMode === null ? Boolean(envDefault) : Boolean(normalized.recipientTestMode);
}

export function getRecipientTestModeSource(settings = DEFAULT_REPORT_SEND_SETTINGS) {
  const normalized = normalizeReportSendSettings(settings);
  return normalized.recipientTestMode === null ? 'env' : 'dashboard';
}

export function isAttendanceNotificationEnabled(eventType, settings = DEFAULT_ATTENDANCE_NOTIFICATION_SETTINGS) {
  const normalized = normalizeAttendanceNotificationSettings(settings);
  if (eventType === 'check_in') return normalized.checkInEnabled;
  if (eventType === 'check_out') return normalized.checkOutEnabled;
  if (eventType === 'away') return normalized.awayEnabled;
  if (eventType === 'return') return normalized.returnEnabled;
  if (eventType === 'return_overdue') return normalized.returnOverdueEnabled;
  return false;
}

export async function getReportSendSettings(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', REPORT_SEND_SETTINGS_KEY)
      .maybeSingle();

    if (error) throw error;
    return {
      settings: normalizeReportSendSettings(data?.setting_value || DEFAULT_REPORT_SEND_SETTINGS),
      exists: Boolean(data),
      warning: null,
    };
  } catch (error) {
    return {
      settings: normalizeReportSendSettings(DEFAULT_REPORT_SEND_SETTINGS),
      exists: false,
      warning: error?.message || 'report_send_settings 조회 실패',
    };
  }
}

export async function saveReportSendSettings(supabase, settings = {}) {
  const normalized = normalizeReportSendSettings(settings);
  const { data, error } = await supabase
    .from('system_settings')
    .upsert({
      setting_key: REPORT_SEND_SETTINGS_KEY,
      setting_value: normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    .select('setting_value')
    .single();

  if (error) throw error;
  return normalizeReportSendSettings(data?.setting_value || normalized);
}
