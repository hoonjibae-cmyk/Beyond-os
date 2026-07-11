// Beyond OS v40-114
// 기본 시간표 설정 공통 유틸리티
// - system_settings.default_schedule에 저장되는 설정값을 정규화합니다.
// - 서버와 클라이언트가 같은 fallback 기준을 쓰도록 분리했습니다.

export const DEFAULT_SCHEDULE_SETTING_KEY = 'default_schedule';

export const FALLBACK_DEFAULT_SCHEDULE_SETTINGS = {
  scheduleLabel: '1~11차시 기본 시간표',
  plannedCheckIn: '09:00',
  plannedCheckOut: '22:00',
  studyWindows: [
    { label: '1차시', start: '09:00', end: '09:50' },
    { label: '2차시', start: '10:00', end: '10:50' },
    { label: '3차시', start: '11:00', end: '11:50' },
    { label: '4차시', start: '13:00', end: '13:50' },
    { label: '5차시', start: '14:00', end: '14:50' },
    { label: '6차시', start: '15:00', end: '15:50' },
    { label: '7차시', start: '16:00', end: '16:50' },
    { label: '8차시', start: '17:00', end: '17:50' },
    { label: '9차시', start: '19:00', end: '19:50' },
    { label: '10차시', start: '20:00', end: '20:50' },
    { label: '11차시', start: '21:00', end: '21:50' },
    { label: '자율학습', start: '22:00', end: '24:00' },
  ],
};

export function timeToMinutes24(value) {
  const raw = String(value || '').trim();
  if (raw === '24:00') return 24 * 60;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  if (hour === 24 && minute !== 0) return null;
  return hour * 60 + minute;
}

export function minutesToTime24(minutes) {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes || 0) / 5) * 5));
  if (safe >= 24 * 60) return '24:00';
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isFiveMinuteTime24(value) {
  const minutes = timeToMinutes24(value);
  return minutes !== null && minutes % 5 === 0;
}

function normalizeTime(value, fallback, { allow24 = false } = {}) {
  const raw = String(value || '').trim();
  const minutes = timeToMinutes24(raw);
  if (minutes === null || minutes % 5 !== 0) return fallback;
  if (!allow24 && minutes >= 24 * 60) return fallback;
  return minutesToTime24(minutes);
}

export function normalizeDefaultScheduleSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallback = FALLBACK_DEFAULT_SCHEDULE_SETTINGS;
  const plannedCheckIn = normalizeTime(source.plannedCheckIn || source.planned_check_in, fallback.plannedCheckIn);
  let plannedCheckOut = normalizeTime(source.plannedCheckOut || source.planned_check_out, fallback.plannedCheckOut, { allow24: true });
  if ((timeToMinutes24(plannedCheckOut) ?? 0) <= (timeToMinutes24(plannedCheckIn) ?? 0)) {
    plannedCheckOut = fallback.plannedCheckOut;
  }

  const rawWindows = Array.isArray(source.studyWindows || source.study_windows)
    ? (source.studyWindows || source.study_windows)
    : fallback.studyWindows;

  const studyWindows = rawWindows
    .map((item, index) => {
      const start = normalizeTime(item?.start, '', { allow24: false });
      const end = normalizeTime(item?.end, '', { allow24: true });
      const startMinute = timeToMinutes24(start);
      const endMinute = timeToMinutes24(end);
      if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;
      return {
        label: String(item?.label || `${index + 1}차시`).trim() || `${index + 1}차시`,
        start,
        end,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (timeToMinutes24(a.start) || 0) - (timeToMinutes24(b.start) || 0));

  const safeWindows = studyWindows.length ? studyWindows : fallback.studyWindows;
  const scheduleLabel = String(source.scheduleLabel || source.schedule_label || fallback.scheduleLabel).trim() || fallback.scheduleLabel;

  return {
    scheduleLabel,
    plannedCheckIn,
    plannedCheckOut,
    studyWindows: safeWindows,
  };
}
