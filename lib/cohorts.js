// Beyond OS v41-148
// 기수(코호트) 공용 로직입니다.
//
// 기수 = 기간(start_date ~ end_date) + 수강 명단(cohort_students)
// 순공시간·랭킹·리포트를 기수 단위로 나눠 보려면 "어느 기간을, 누구를" 집계할지만 정하면 되므로
// 출결 원본 데이터에는 기수 정보를 심지 않고 여기서 계산합니다.

export const COHORT_SETTINGS_KEY = 'cohort_settings';

export const DEFAULT_COHORT_SETTINGS = {
  // 화면에서 기본으로 선택될 기수. null이면 오늘 날짜가 포함된 기수를 씁니다.
  activeCohortId: null,
  // 두 기수를 연속 수강하는 학생의 기록을 기수별로 끊을지 여부.
  //   true  = 분리: 2기 집계는 2기 기간만. (기수별 경쟁/리포트에 적합 · 기본값)
  //   false = 연속: 이전 기수부터 누적해서 이어감.
  separateAcrossCohorts: true,
};

function toDateString(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(raw)) return true;
    if (['false', '0', 'off', 'no'].includes(raw)) return false;
  }
  return fallback;
}

export function normalizeCohortSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const activeCohortId = String(source.activeCohortId ?? source.active_cohort_id ?? '').trim();
  return {
    activeCohortId: activeCohortId || null,
    separateAcrossCohorts: normalizeBoolean(
      source.separateAcrossCohorts ?? source.separate_across_cohorts,
      DEFAULT_COHORT_SETTINGS.separateAcrossCohorts,
    ),
  };
}

export function normalizeCohort(row = {}) {
  const start = toDateString(row.start_date ?? row.startDate);
  const end = toDateString(row.end_date ?? row.endDate);
  return {
    id: String(row.id || ''),
    name: String(row.name || '').trim() || '이름 없는 기수',
    startDate: start,
    endDate: end,
    sortOrder: Number.isFinite(Number(row.sort_order ?? row.sortOrder)) ? Number(row.sort_order ?? row.sortOrder) : 0,
    memo: String(row.memo || '').trim(),
    isActive: row.is_active !== false && row.isActive !== false,
    createdBy: row.created_by || row.createdBy || '',
  };
}

// 기간이 빠졌거나 순서가 뒤집힌 기수는 집계에 쓸 수 없습니다.
export function isUsableCohort(cohort) {
  return Boolean(cohort?.startDate && cohort?.endDate && cohort.startDate <= cohort.endDate);
}

// 시작일 오름차순으로 정렬합니다. (1기 → 2기 → …)
export function sortCohorts(cohorts = []) {
  return [...(cohorts || [])].sort((a, b) => {
    const byStart = String(a.startDate || '').localeCompare(String(b.startDate || ''));
    if (byStart) return byStart;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

// 특정 날짜가 포함된 기수를 찾습니다. 겹치면 나중에 시작한 기수를 우선합니다.
export function resolveCohortForDate(cohorts = [], dateString = '') {
  const date = toDateString(dateString);
  if (!date) return null;
  const matched = sortCohorts((cohorts || []).filter(isUsableCohort))
    .filter((cohort) => cohort.startDate <= date && date <= cohort.endDate);
  return matched.length ? matched[matched.length - 1] : null;
}

// 화면에서 기본으로 보여줄 기수를 고릅니다.
// 설정된 기수 → 오늘이 포함된 기수 → 가장 최근 기수 순으로 찾습니다.
export function resolveDefaultCohort(cohorts = [], settings = DEFAULT_COHORT_SETTINGS, today = '') {
  const usable = sortCohorts((cohorts || []).filter(isUsableCohort));
  if (!usable.length) return null;
  const configured = settings?.activeCohortId
    ? usable.find((cohort) => String(cohort.id) === String(settings.activeCohortId))
    : null;
  if (configured) return configured;
  const byToday = resolveCohortForDate(usable, today);
  if (byToday) return byToday;
  return usable[usable.length - 1];
}

/**
 * 한 학생의 집계 기간을 계산합니다.
 *
 * 분리(separateAcrossCohorts = true)면 항상 해당 기수 기간만 봅니다.
 * 연속(false)이면, 이 학생이 이전 기수에도 있었을 경우 가장 처음 들어간 기수의
 * 시작일부터 이어서 집계합니다. (신규 학생은 이번 기수부터)
 *
 * @param {Object} cohort           대상 기수
 * @param {Array}  cohorts          전체 기수 목록
 * @param {Set}    studentCohortIds 이 학생이 속한 기수 id 집합
 * @param {Object} settings         기수 정책
 */
export function resolveStudentCohortRange(cohort, cohorts = [], studentCohortIds = new Set(), settings = DEFAULT_COHORT_SETTINGS) {
  if (!isUsableCohort(cohort)) return null;
  const normalized = normalizeCohortSettings(settings);
  const base = { start: cohort.startDate, end: cohort.endDate, continued: false };
  if (normalized.separateAcrossCohorts) return base;

  // 연속 정책: 이 학생이 속한 기수 중 이번 기수보다 먼저 시작한 기수를 찾습니다.
  const earlier = sortCohorts((cohorts || []).filter(isUsableCohort))
    .filter((item) => studentCohortIds.has(String(item.id)) && item.startDate < cohort.startDate);
  if (!earlier.length) return base;

  return { start: earlier[0].startDate, end: cohort.endDate, continued: true };
}

// 표시용 라벨: "비욘드 1기 (07.21~08.16)"
export function formatCohortLabel(cohort) {
  if (!cohort) return '';
  const range = cohort.startDate && cohort.endDate
    ? ` (${cohort.startDate.slice(5).replace('-', '.')}~${cohort.endDate.slice(5).replace('-', '.')})`
    : '';
  return `${cohort.name}${range}`;
}

export function getCohortDayCount(cohort) {
  if (!isUsableCohort(cohort)) return 0;
  const start = new Date(`${cohort.startDate}T00:00:00+09:00`);
  const end = new Date(`${cohort.endDate}T00:00:00+09:00`);
  return Math.floor((end - start) / 86400000) + 1;
}

// 기간이 겹치는 기수를 찾아 알려줍니다. (겹침 자체를 막지는 않고 경고만)
export function findOverlappingCohorts(cohort, cohorts = []) {
  if (!isUsableCohort(cohort)) return [];
  return (cohorts || [])
    .filter(isUsableCohort)
    .filter((item) => String(item.id) !== String(cohort.id))
    .filter((item) => item.startDate <= cohort.endDate && cohort.startDate <= item.endDate);
}

export async function getCohortSettings(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', COHORT_SETTINGS_KEY)
      .maybeSingle();
    if (error) throw error;
    return normalizeCohortSettings(data?.setting_value || DEFAULT_COHORT_SETTINGS);
  } catch {
    return normalizeCohortSettings(DEFAULT_COHORT_SETTINGS);
  }
}

export async function saveCohortSettings(supabase, settings = {}) {
  const normalized = normalizeCohortSettings(settings);
  const { data, error } = await supabase
    .from('system_settings')
    .upsert({
      setting_key: COHORT_SETTINGS_KEY,
      setting_value: normalized,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    .select('setting_value')
    .single();
  if (error) throw error;
  return normalizeCohortSettings(data?.setting_value || normalized);
}

// 기수 목록과 명단을 함께 읽습니다. SQL 미실행 환경에서도 앱이 멈추지 않도록 폴백합니다.
export async function loadCohortContext(supabase) {
  const settings = await getCohortSettings(supabase);
  try {
    const { data: cohortRows, error: cohortError } = await supabase
      .from('cohorts')
      .select('*')
      .order('start_date', { ascending: true });
    if (cohortError) throw cohortError;

    const cohorts = sortCohorts((cohortRows || []).map(normalizeCohort));

    const { data: rosterRows, error: rosterError } = await supabase
      .from('cohort_students')
      .select('cohort_id, student_id, is_active')
      .eq('is_active', true);
    if (rosterError) throw rosterError;

    const rosterByCohort = {};
    const cohortIdsByStudent = {};
    for (const row of rosterRows || []) {
      const cohortId = String(row.cohort_id || '');
      const studentId = String(row.student_id || '');
      if (!cohortId || !studentId) continue;
      if (!rosterByCohort[cohortId]) rosterByCohort[cohortId] = new Set();
      rosterByCohort[cohortId].add(studentId);
      if (!cohortIdsByStudent[studentId]) cohortIdsByStudent[studentId] = new Set();
      cohortIdsByStudent[studentId].add(cohortId);
    }

    return { cohorts, rosterByCohort, cohortIdsByStudent, settings, available: true, warning: '' };
  } catch (error) {
    return {
      cohorts: [],
      rosterByCohort: {},
      cohortIdsByStudent: {},
      settings,
      available: false,
      warning: `기수 정보를 읽지 못했습니다(${error?.message || error}). beyond-os-supabase-cohorts-v41-148.sql 실행 여부를 확인하세요.`,
    };
  }
}
