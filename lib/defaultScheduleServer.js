import {
  DEFAULT_SCHEDULE_SETTING_KEY,
  COHORT_SCHEDULE_KEY_PREFIX,
  FALLBACK_DEFAULT_SCHEDULE_SETTINGS,
  normalizeDefaultScheduleSettings,
  normalizeDefaultScheduleConfig,
  parseCohortScheduleSettingKey,
  resolveScheduleForDate,
} from './defaultSchedule';

// v41-177: 공통 설정과 기수별 설정을 한 번에 읽어, 기수 기간 정보를 붙여 돌려줍니다.
// 기수별 설정이 하나도 없으면 예전과 똑같이 공통 설정만 담깁니다.
async function readRawDefaultScheduleValue(supabase) {
  // system_settings 는 설정 몇 줄뿐이라 통째로 읽고 코드에서 고릅니다.
  // (키에 콜론이 들어 있어 PostgREST or/like 필터를 쓰면 이스케이프가 까다롭습니다)
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value');

  if (error) throw error;

  const rows = (data || []).filter((row) => (
    row.setting_key === DEFAULT_SCHEDULE_SETTING_KEY
    || String(row.setting_key || '').startsWith(COHORT_SCHEDULE_KEY_PREFIX)
  ));
  const globalRow = rows.find((row) => row.setting_key === DEFAULT_SCHEDULE_SETTING_KEY);
  const base = globalRow?.setting_value || FALLBACK_DEFAULT_SCHEDULE_SETTINGS;

  const cohortRows = rows
    .map((row) => ({ id: parseCohortScheduleSettingKey(row.setting_key), value: row.setting_value }))
    .filter((row) => row.id && row.value);
  if (!cohortRows.length) return base;

  // 기수 기간은 cohorts 테이블에서 가져옵니다. 기수 테이블이 없으면 공통 설정만 씁니다.
  let cohorts = [];
  try {
    const { data: cohortData } = await supabase
      .from('cohorts')
      .select('id, name, start_date, end_date')
      .in('id', cohortRows.map((row) => row.id));
    cohorts = cohortData || [];
  } catch {
    cohorts = [];
  }
  if (!cohorts.length) return base;

  const cohortById = {};
  for (const cohort of cohorts) cohortById[String(cohort.id)] = cohort;

  const cohortSchedules = cohortRows
    .map((row) => {
      const cohort = cohortById[String(row.id)];
      if (!cohort) return null;
      return {
        id: String(cohort.id),
        name: cohort.name || '',
        startDate: String(cohort.start_date || '').slice(0, 10),
        endDate: String(cohort.end_date || '').slice(0, 10),
        config: row.value,
      };
    })
    .filter(Boolean);

  return { ...(base && typeof base === 'object' ? base : {}), cohortSchedules };
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
