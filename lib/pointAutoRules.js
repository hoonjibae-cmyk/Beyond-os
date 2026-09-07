// Beyond OS v41-241
// 주간 순공시간 자동 상점 · 상품 지급 스캔 기준을 담는 공용 모듈입니다.
//
// 이 파일에는 저장된 설정값을 다듬는 함수와 주(월~일) 계산만 들어 있습니다.
// DB 를 읽는 쪽은 lib/pointAutoRulesServer.js 입니다.
//
// 운영 규칙
//   1) 주간 순공시간 집계 구간은 월요일 ~ 일요일입니다.
//   2) 그 다음 월요일 06:00(KST)에 구간표를 보고 상점을 일괄 부여합니다.
//   3) 같은 월요일에 전체 학생의 순점수를 한 번 스캔해 상품 지급 대상 명단을 만듭니다.
//      (예전처럼 화면을 열 때마다 실시간으로 판정하지 않습니다)

export const DEFAULT_POINT_AUTO_RULES = {
  // 주간 순공 자동 상점 사용 여부
  autoRewardEnabled: true,
  // 순공시간 구간표. 처음에는 비어 있습니다.
  //
  // 일부러 기본 구간을 넣지 않았습니다. 몇 시간에 몇 점인지는 운영 판단이라
  // 시스템이 임의로 정해 두면 배포 다음 월요일에 뜻하지 않은 상점이 나갑니다.
  // 화면에서 구간을 추가하고 저장해야 부여가 시작됩니다.
  tiers: [],
  // 상품 지급 대상 기준 순점수. 이 점수를 "초과"하면 명단에 오릅니다.
  rewardThreshold: 15,
  // 몇 주 연속으로 대상에 오르면 따로 표시할지
  streakWeeks: 2,

  // v41-242: 주간 개근 상점.
  //
  // 순공시간 구간 상점과 별개로 함께 받을 수 있습니다. (중복 지급)
  // 그 주에 예정된 등원일을 전부 지켰고, 지각·결석이 하나도 없어야 합니다.
  perfectAttendanceEnabled: true,
  // 0점이면 부여하지 않습니다. 구간표를 비워 둔 것과 같은 이유로 기본은 0점입니다.
  perfectAttendancePoints: 0,
  // 그날 등원을 인정하는 최소 순공시간(분). 잠깐 찍고 가는 날을 개근으로 세지 않기 위한 값입니다.
  perfectAttendanceDailyMinutes: 30,
};

export const AUTO_AWARD_KINDS = {
  study: '주간 순공',
  perfect: '주간 개근',
};

export function getAutoAwardKindLabel(kind) {
  return AUTO_AWARD_KINDS[String(kind || 'study')] || AUTO_AWARD_KINDS.study;
}

export const AUTO_TABLE_HINT = 'beyond-os-supabase-point-auto-perfect-v41-242.sql 실행 여부를 확인하세요.';

export const MAX_AUTO_TIERS = 10;
export const MAX_TIER_POINTS = 100;

// 화면에서 [기본 구간 예시 넣기]를 눌렀을 때 채워 넣는 초안입니다.
// 저장하기 전까지는 어디에도 반영되지 않습니다.
export const SAMPLE_POINT_AUTO_TIERS = [
  { minMinutes: 3300, points: 5, label: '' },
  { minMinutes: 3000, points: 3, label: '' },
  { minMinutes: 2700, points: 1, label: '' },
];

function toInt(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 구간표를 다듬습니다.
 *   - 점수 1점 미만인 줄은 버립니다. (0점 구간은 부여할 것이 없습니다)
 *   - 기준 시간이 같은 줄은 첫 줄만 남깁니다.
 *   - 기준 시간이 큰 순서로 정렬합니다. 판정할 때 위에서부터 처음 걸리는 줄을 씁니다.
 */
export function normalizePointAutoTiers(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const minMinutes = toInt(item?.minMinutes ?? item?.min_minutes, NaN);
    const points = toInt(item?.points, NaN);
    if (!Number.isFinite(minMinutes) || minMinutes < 0) continue;
    if (!Number.isFinite(points) || points < 1) continue;
    if (seen.has(minMinutes)) continue;
    seen.add(minMinutes);
    out.push({
      minMinutes,
      points: Math.min(MAX_TIER_POINTS, points),
      label: String(item?.label || '').trim().slice(0, 40),
    });
  }
  return out.sort((a, b) => b.minMinutes - a.minMinutes).slice(0, MAX_AUTO_TIERS);
}

export function normalizePointAutoRules(value = {}) {
  const merged = { ...DEFAULT_POINT_AUTO_RULES, ...(value || {}) };
  const threshold = toInt(merged.rewardThreshold, DEFAULT_POINT_AUTO_RULES.rewardThreshold);
  const streak = toInt(merged.streakWeeks, DEFAULT_POINT_AUTO_RULES.streakWeeks);
  return {
    autoRewardEnabled: merged.autoRewardEnabled !== false,
    tiers: normalizePointAutoTiers(merged.tiers),
    rewardThreshold: threshold >= 0 ? threshold : DEFAULT_POINT_AUTO_RULES.rewardThreshold,
    // 2주 연속부터 의미가 있습니다. 1로 두면 매주 전원이 '연속'이 되어 구분이 사라집니다.
    streakWeeks: streak >= 2 ? Math.min(20, streak) : DEFAULT_POINT_AUTO_RULES.streakWeeks,
    perfectAttendanceEnabled: merged.perfectAttendanceEnabled !== false,
    perfectAttendancePoints: Math.min(MAX_TIER_POINTS, Math.max(0, toInt(merged.perfectAttendancePoints, 0))),
    // 0분으로 두면 '체크인만 하면 개근'이 되어 버립니다. 최소 1분은 남깁니다.
    perfectAttendanceDailyMinutes: Math.min(1440, Math.max(1, toInt(merged.perfectAttendanceDailyMinutes, DEFAULT_POINT_AUTO_RULES.perfectAttendanceDailyMinutes))),
  };
}

/**
 * 주간 순공시간에 해당하는 구간을 돌려줍니다. 없으면 null.
 *
 * 기준은 "이상"입니다. 2700분 구간은 2700분부터 걸립니다.
 * 순공시간이 0분인 주(한 번도 등원하지 않은 주)에는 어떤 구간도 주지 않습니다.
 * 기준 0분 구간을 만들어 두더라도 마찬가지입니다.
 */
export function resolveStudyTier(minutes, tiers = []) {
  const total = Number(minutes || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const list = normalizePointAutoTiers(tiers);
  return list.find((tier) => total >= tier.minMinutes) || null;
}

// ── 주간 개근 판정 ────────────────────────────────────────────

/** "HH:MM..." → 자정부터의 분. 못 읽으면 null */
function timeStringToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** ISO 시각 → 그날 KST 기준 분. KST 는 서머타임이 없어 +9시간 고정으로 계산합니다. */
export function isoToKstMinuteOfDay(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.round(time / 60000 + 9 * 60) % 1440;
}

/**
 * 주간 개근 판정.
 *
 * v41-243: 기준을 "개인 시간표에 잡힌 예정 등원일"에서 "그 주 센터 운영일 전부"로
 * 바꿨습니다.
 *
 * 왜 바꿨나
 *   개인 시간표를 기준으로 삼으면 시간표가 없는 날이 판정에서 통째로 빠집니다.
 *   일요일 시간표를 만들지 않은 학생은 일요일에 오지 않아도 개근이 되고,
 *   월요일을 결석으로 등록해 둔 학생은 월요일에 오지 않아도 개근이 됐습니다.
 *
 *   개근 상점은 "운영 시간 이후 자율학습에라도 매일 나오라"는 뜻으로 만든 것이므로,
 *   센터가 문을 여는 날은 시간표가 있든 없든, 결석으로 잡아 뒀든 아니든 나와야 합니다.
 *
 * 기준
 *   1) 대상일 = 그 주(월~일) 중 센터가 운영하는 날.
 *      공휴일·미운영 요일(설정 · 기본 시간표에서 꺼 둔 날)은 대상에서 빠집니다.
 *   2) 대상일마다 등원 기록이 있어야 합니다. 미등원·결석이면 실패입니다.
 *      개인 시간표에 결석으로 등록해 둔 날도 나와야 합니다.
 *   3) 대상일마다 순공시간이 일일 최소치 이상이어야 합니다.
 *   4) 개인 시간표에 등원 시각이 정해진 날은 지각도 보지 않습니다.
 *      시간표가 없는 날(일요일 자율학습 등)은 정해진 시각이 없으므로 지각을 보지 않습니다.
 *
 * 조퇴는 보지 않습니다. (요청 기준이 무지각·무결석)
 *
 * @param {string[]} options.operatingDates 그 주 운영일 목록 (YYYY-MM-DD)
 * @returns {{ok: boolean, operatingDays: number, attendedDays: number, failures: Array}}
 */
export function evaluatePerfectAttendance({
  operatingDates = [],
  schedules = [],
  sessionsByDate = {},
  minutesByDate = {},
  dailyMinMinutes = DEFAULT_POINT_AUTO_RULES.perfectAttendanceDailyMinutes,
  lateThresholdMinutes = 1,
} = {}) {
  const dates = [...new Set((Array.isArray(operatingDates) ? operatingDates : [])
    .map((value) => String(value || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();

  if (!dates.length) {
    return { ok: false, operatingDays: 0, attendedDays: 0, failures: [{ date: '', reason: '이번 주 운영일 없음' }] };
  }

  // 지각 판정용 예정 등원 시각. 결석으로 등록해 둔 날은 지킬 시각이 없으므로 비웁니다.
  const plannedInByDate = {};
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const date = String(schedule?.schedule_date || '').slice(0, 10);
    if (!date || schedule?.planned_absent) continue;
    const minute = timeStringToMinutes(schedule?.planned_check_in);
    if (minute !== null) plannedInByDate[date] = minute;
  }

  const failures = [];
  let attendedDays = 0;

  for (const date of dates) {
    const session = sessionsByDate[date];
    if (!session || !session.check_in_at) {
      failures.push({ date, reason: '미등원' });
      continue;
    }
    if (session.seat_status === 'absent') {
      failures.push({ date, reason: '결석' });
      continue;
    }
    const plannedIn = plannedInByDate[date];
    if (plannedIn !== undefined) {
      const checkInMinute = isoToKstMinuteOfDay(session.check_in_at);
      if (checkInMinute !== null && checkInMinute > plannedIn + Number(lateThresholdMinutes || 0)) {
        failures.push({ date, reason: '지각' });
        continue;
      }
    }
    const minutes = Number(minutesByDate[date] || 0);
    if (minutes < Number(dailyMinMinutes || 0)) {
      failures.push({ date, reason: `순공 ${minutes}분 (최소 ${dailyMinMinutes}분)` });
      continue;
    }
    attendedDays += 1;
  }

  return {
    ok: failures.length === 0 && attendedDays === dates.length,
    operatingDays: dates.length,
    attendedDays,
    failures,
  };
}

// ── 주(월~일) 계산 ────────────────────────────────────────────
// 날짜 문자열(YYYY-MM-DD)만 다루므로 UTC 자정에 고정해 시간대 영향을 없앱니다.

function toUtcDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDaysToDateString(value, days) {
  const date = toUtcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
export function getWeekStartMonday(value) {
  const date = toUtcDate(value);
  if (!date) return '';
  const day = date.getUTCDay(); // 0=일요일
  return addDaysToDateString(value, day === 0 ? -6 : 1 - day);
}

/**
 * 집계 대상 주(직전 월~일)를 돌려줍니다.
 * 월요일에 돌리면 바로 전 주가, 주중에 수동 실행해도 같은 전 주가 나옵니다.
 */
export function getPreviousWeekRange(value) {
  const thisMonday = getWeekStartMonday(value);
  if (!thisMonday) return { start: '', end: '' };
  const start = addDaysToDateString(thisMonday, -7);
  return { start, end: addDaysToDateString(start, 6) };
}

export function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hour = Math.floor(total / 60);
  const rest = total % 60;
  if (!hour) return `${rest}분`;
  if (!rest) return `${hour}시간`;
  return `${hour}시간 ${rest}분`;
}
