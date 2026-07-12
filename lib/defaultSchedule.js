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

// ─────────────────────────────────────────────────────────────
// v41-40: 요일 유형별(평일/토요일/일요일/공휴일) 기본 시간표
//
// 저장 구조(system_settings.default_schedule)는 하위호환을 위해
// 상단에 '평일' 시간표를 평탄(flat)하게 그대로 보관합니다.
//   => 기존 normalizeDefaultScheduleSettings() 와 이를 쓰는 모든
//      소비자는 그대로 '평일' 기준값을 받습니다. (동작 변화 없음)
// 여기에 variants(요일 유형별) 와 holidays(공휴일 날짜 목록)를 덧붙입니다.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_SCHEDULE_DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday'];

export const DEFAULT_SCHEDULE_DAY_TYPE_LABELS = {
  weekday: '평일',
  saturday: '토요일',
  sunday: '일요일',
  holiday: '공휴일',
};

// 요일 유형별 기본 운영 여부 (최초 마이그레이션/기본값)
// - 평일: 운영, 토요일: 운영(v41-40 반영), 일요일/공휴일: 미운영
const DEFAULT_DAY_TYPE_ENABLED = {
  weekday: true,
  saturday: true,
  sunday: false,
  holiday: false,
};

function normalizeDayVariant(value, baseSchedule, enabledFallback) {
  const source = value && typeof value === 'object' ? value : {};
  const ownWindows = source.studyWindows || source.study_windows;
  const scheduleSource = {
    scheduleLabel: source.scheduleLabel || source.schedule_label || baseSchedule.scheduleLabel,
    plannedCheckIn: source.plannedCheckIn || source.planned_check_in || baseSchedule.plannedCheckIn,
    plannedCheckOut: source.plannedCheckOut || source.planned_check_out || baseSchedule.plannedCheckOut,
    studyWindows: Array.isArray(ownWindows) && ownWindows.length ? ownWindows : baseSchedule.studyWindows,
  };
  const schedule = normalizeDefaultScheduleSettings(scheduleSource);
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : Boolean(enabledFallback);
  return { enabled, ...schedule };
}

function normalizeHolidayDate(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeHolidayList(value) {
  const arr = Array.isArray(value) ? value : [];
  const set = new Set();
  for (const item of arr) {
    const raw = item && typeof item === 'object' ? (item.date || item.day || item.value) : item;
    const date = normalizeHolidayDate(raw);
    if (date) set.add(date);
  }
  return [...set].sort();
}

export function normalizeDefaultScheduleConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const variantsSource = source.variants && typeof source.variants === 'object' ? source.variants : {};

  // 평일(base): variants.weekday 우선, 없으면 상단 평탄값(레거시), 그것도 없으면 fallback
  const legacyFlatHasSchedule = Array.isArray(source.studyWindows || source.study_windows)
    || source.plannedCheckIn || source.planned_check_in;
  const weekdaySource = variantsSource.weekday
    || (legacyFlatHasSchedule ? source : null)
    || FALLBACK_DEFAULT_SCHEDULE_SETTINGS;

  const weekday = normalizeDayVariant(weekdaySource, FALLBACK_DEFAULT_SCHEDULE_SETTINGS, DEFAULT_DAY_TYPE_ENABLED.weekday);
  const base = {
    scheduleLabel: weekday.scheduleLabel,
    plannedCheckIn: weekday.plannedCheckIn,
    plannedCheckOut: weekday.plannedCheckOut,
    studyWindows: weekday.studyWindows,
  };

  const saturday = normalizeDayVariant(variantsSource.saturday, base, DEFAULT_DAY_TYPE_ENABLED.saturday);
  const sunday = normalizeDayVariant(variantsSource.sunday, base, DEFAULT_DAY_TYPE_ENABLED.sunday);
  const holiday = normalizeDayVariant(variantsSource.holiday, base, DEFAULT_DAY_TYPE_ENABLED.holiday);
  const holidays = normalizeHolidayList(source.holidays || source.holiday_dates);

  return {
    // 하위호환용 상단 평탄 미러(= 평일)
    scheduleLabel: weekday.scheduleLabel,
    plannedCheckIn: weekday.plannedCheckIn,
    plannedCheckOut: weekday.plannedCheckOut,
    studyWindows: weekday.studyWindows,
    variants: { weekday, saturday, sunday, holiday },
    holidays,
  };
}

// KST 기준 날짜 문자열(YYYY-MM-DD)의 요일 유형을 판정합니다.
export function getDayTypeForDate(config, dateString) {
  const holidays = config && Array.isArray(config.holidays) ? config.holidays : [];
  if (dateString && holidays.includes(dateString)) return 'holiday';
  const dow = new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

// 특정 날짜에 적용할 시간표를 평탄 형태로 반환합니다.
// 반환값은 normalizeDefaultScheduleSettings() 결과와 동일한 필드에
// operating / dayType 메타를 추가한 형태입니다. (기존 소비자와 호환)
export function resolveScheduleForDate(configOrValue, dateString) {
  const config = configOrValue && configOrValue.variants
    ? configOrValue
    : normalizeDefaultScheduleConfig(configOrValue);
  const dayType = getDayTypeForDate(config, dateString);
  const variant = config.variants?.[dayType] || config.variants?.weekday;
  return {
    dayType,
    operating: Boolean(variant?.enabled),
    scheduleLabel: variant.scheduleLabel,
    plannedCheckIn: variant.plannedCheckIn,
    plannedCheckOut: variant.plannedCheckOut,
    studyWindows: variant.studyWindows,
  };
}
