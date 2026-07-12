import {
  DEFAULT_SCHEDULE_SETTING_KEY,
  FALLBACK_DEFAULT_SCHEDULE_SETTINGS,
  normalizeDefaultScheduleSettings,
  normalizeDefaultScheduleConfig,
  resolveScheduleForDate,
} from './defaultSchedule';

async function readRawDefaultScheduleValue(supabase) {
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_value')
    .eq('setting_key', DEFAULT_SCHEDULE_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  return data?.setting_value || FALLBACK_DEFAULT_SCHEDULE_SETTINGS;
}

// 요일 유형별 전체 설정(평일/토/일/공휴일 + 공휴일 날짜 목록)을 반환합니다.
export async function getDefaultScheduleConfig(supabase) {
  try {
    return normalizeDefaultScheduleConfig(await readRawDefaultScheduleValue(supabase));
  } catch {
    return normalizeDefaultScheduleConfig(FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
  }
}

// 하위호환:
// - dateString 없이 호출하면 기존과 동일하게 '평일(기본)' 시간표를 평탄 형태로 반환합니다.
// - dateString(YYYY-MM-DD)을 주면 해당 날짜의 요일 유형에 맞는 시간표를 반환합니다.
//   반환값에는 operating / dayType 메타가 추가되지만, 기존 소비자가 쓰는
//   studyWindows / plannedCheckIn / plannedCheckOut 필드는 그대로 유지됩니다.
export async function getDefaultScheduleSettings(supabase, dateString) {
  try {
    const raw = await readRawDefaultScheduleValue(supabase);
    if (dateString) {
      return resolveScheduleForDate(normalizeDefaultScheduleConfig(raw), dateString);
    }
    return normalizeDefaultScheduleSettings(raw);
  } catch {
    if (dateString) {
      return resolveScheduleForDate(normalizeDefaultScheduleConfig(FALLBACK_DEFAULT_SCHEDULE_SETTINGS), dateString);
    }
    return normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
  }
}
