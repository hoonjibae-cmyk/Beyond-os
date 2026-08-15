// Beyond OS v41-179
// 멘토링 운영 기준입니다.
//
// 지금까지 멘토링 설정 화면의 '운영 기준' 카드에 적혀 있던 값들(기본 요일 월·수·금,
// 임시 추가 화·목, 차시당 3~4명, 좌석표 10분 전 표시)은 코드에 박힌 안내문이었습니다.
// 기수마다 달라지므로 저장되는 설정으로 바꿉니다.
//
// 저장 위치는 기본 시간표(v41-177)와 같은 방식입니다. 새 테이블이 필요 없습니다.
//   공통   : system_settings['mentoring_policy']
//   기수별 : system_settings['mentoring_policy:cohort:<기수 id>']

export const MENTORING_POLICY_SETTING_KEY = 'mentoring_policy';
export const MENTORING_POLICY_COHORT_KEY_PREFIX = `${MENTORING_POLICY_SETTING_KEY}:cohort:`;

export function getMentoringPolicyCohortKey(cohortId) {
  return `${MENTORING_POLICY_COHORT_KEY_PREFIX}${String(cohortId || '').trim()}`;
}

export function parseMentoringPolicyCohortKey(settingKey) {
  const raw = String(settingKey || '');
  return raw.startsWith(MENTORING_POLICY_COHORT_KEY_PREFIX)
    ? raw.slice(MENTORING_POLICY_COHORT_KEY_PREFIX.length)
    : '';
}

// v41-180: 토·일 멘토링도 고를 수 있습니다.
// 순서는 달력이 아니라 운영 감각에 맞춰 월요일부터 시작합니다.
export const MENTORING_DAY_OPTIONS = [
  [1, '월'],
  [2, '화'],
  [3, '수'],
  [4, '목'],
  [5, '금'],
  [6, '토'],
  [0, '일'],
];

// 정렬은 월(1)~토(6), 일(0)은 맨 뒤로 보냅니다.
function daySortKey(day) {
  return Number(day) === 0 ? 7 : Number(day);
}

export const FALLBACK_MENTORING_POLICY = {
  // 기본 차시를 자동 생성하는 요일
  baseDays: [1, 3, 5],
  // 필요할 때 차시를 추가로 만들 수 있는 요일
  extraDays: [2, 4],
  // 차시당 권장 인원
  minCapacity: 3,
  maxCapacity: 4,
  // 좌석표에 멘토링 안내를 띄우기 시작하는 시점 (차시 시작 N분 전)
  seatBoardLeadMinutes: 10,
};

function normalizeDayList(value, fallback) {
  const allowed = MENTORING_DAY_OPTIONS.map(([day]) => day);
  if (!Array.isArray(value)) return [...fallback];
  const days = [...new Set(
    value.map((item) => Number(item)).filter((day) => allowed.includes(day)),
  )].sort((a, b) => daySortKey(a) - daySortKey(b));
  return days;
}

function normalizeCount(value, fallback, { min = 0, max = 99 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function normalizeMentoringPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const baseDays = normalizeDayList(source.baseDays ?? source.base_days, FALLBACK_MENTORING_POLICY.baseDays);
  // 기본 요일과 임시 요일이 겹치면 기본 쪽만 남깁니다.
  const extraDays = normalizeDayList(source.extraDays ?? source.extra_days, FALLBACK_MENTORING_POLICY.extraDays)
    .filter((day) => !baseDays.includes(day));

  const minCapacity = normalizeCount(
    source.minCapacity ?? source.min_capacity,
    FALLBACK_MENTORING_POLICY.minCapacity,
    { min: 1, max: 30 },
  );
  const maxCapacity = normalizeCount(
    source.maxCapacity ?? source.max_capacity,
    FALLBACK_MENTORING_POLICY.maxCapacity,
    { min: 1, max: 30 },
  );

  return {
    // 기본 요일을 전부 지우면 차시를 만들 수 없으므로 최소 하나는 남깁니다.
    baseDays: baseDays.length ? baseDays : [...FALLBACK_MENTORING_POLICY.baseDays],
    extraDays,
    minCapacity: Math.min(minCapacity, maxCapacity),
    maxCapacity: Math.max(minCapacity, maxCapacity),
    seatBoardLeadMinutes: normalizeCount(
      source.seatBoardLeadMinutes ?? source.seat_board_lead_minutes,
      FALLBACK_MENTORING_POLICY.seatBoardLeadMinutes,
      { min: 0, max: 120 },
    ),
  };
}

// 차시를 만들 수 있는 요일 = 기본 요일 + 임시 요일
export function getSelectableMentoringDays(policy) {
  const normalized = normalizeMentoringPolicy(policy);
  return [...new Set([...normalized.baseDays, ...normalized.extraDays])].sort((a, b) => daySortKey(a) - daySortKey(b));
}

export function formatMentoringDays(days = []) {
  const labelByDay = Object.fromEntries(MENTORING_DAY_OPTIONS);
  const list = [...new Set((days || []).map(Number))].sort((a, b) => daySortKey(a) - daySortKey(b));
  return list.map((day) => labelByDay[day]).filter(Boolean).join('·');
}
