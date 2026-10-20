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

  // v41-256: 학부모 경고 알림 기준.
  //
  // 순벌점(벌점 - 상점)이 이 점수 "이상"이면 대시보드에 경고가 뜨고
  // [알림톡 발송] 버튼이 나옵니다. 화면에 보이는 순점수로는 -15점 이하입니다.
  // 센터장 면담(20점 초과) · 제적 검토(30점 초과) 단계는 설정과 무관하게 그대로입니다.
  penaltyAlertThreshold: 15,

  // v41-242: 주간 개근 상점. v41-270 에서 기준을 바꿨습니다.
  //
  // 순공시간 구간 상점과 별개로 함께 받을 수 있습니다. (중복 지급)
  // 기준 (v41-270, 부원장님 지시)
  //   - 개인 시간표에 차시가 있는 날: 결석 X · 지각 X · 조기 외출 X (시간표를 그대로 지킴)
  //   - 차시가 없는 날(일요일·공휴일·빈 요일 모두): 자율학습 순공 1시간 이상 기록
  //   월~일 7일을 전부 봅니다.
  perfectAttendanceEnabled: true,
  // 0점이면 부여하지 않습니다. v41-270 부터 기본 5점입니다.
  perfectAttendancePoints: 5,
  // 차시가 없는 날에 요구하는 최소 순공시간(분). 기본 60분.
  perfectAttendanceDailyMinutes: 60,
  // 설정 저장본이 옛 기준(v41-242, 0점·30분)인지 구분하는 번호입니다.
  // 2 미만이면 저장된 점수·분을 무시하고 새 기본값(5점·60분)으로 올립니다.
  perfectAttendanceRuleVersion: 2,

  // v41-275: 자율학습 중 장시간 외출 벌점 확인 명단.
  // 외출→복귀로 닫힌 구간 중 자율학습 시간대에 겹치는 분이 기준 이상이면 다음 날 명단에 오릅니다.
  // 벌점은 사람이 [부여]를 눌러야 들어갑니다. (자동 부여 아님)
  longAwayPenaltyEnabled: true,
  longAwayMinutes: 40,
  longAwayPoints: 3,
};

export const PERFECT_ATTENDANCE_RULE_VERSION = 2;

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
  const perfect = upgradePerfectAttendanceRules(merged, value);
  return {
    autoRewardEnabled: merged.autoRewardEnabled !== false,
    tiers: normalizePointAutoTiers(merged.tiers),
    rewardThreshold: threshold >= 0 ? threshold : DEFAULT_POINT_AUTO_RULES.rewardThreshold,
    // 2주 연속부터 의미가 있습니다. 1로 두면 매주 전원이 '연속'이 되어 구분이 사라집니다.
    streakWeeks: streak >= 2 ? Math.min(20, streak) : DEFAULT_POINT_AUTO_RULES.streakWeeks,
    // 0 이하면 벌점이 없는 학생까지 전부 경고 대상이 됩니다. 최소 1점은 남깁니다.
    penaltyAlertThreshold: Math.min(200, Math.max(1, toInt(merged.penaltyAlertThreshold, DEFAULT_POINT_AUTO_RULES.penaltyAlertThreshold))),
    perfectAttendanceEnabled: merged.perfectAttendanceEnabled !== false,
    perfectAttendancePoints: Math.min(MAX_TIER_POINTS, Math.max(0, toInt(perfect.points, 0))),
    // 0분으로 두면 '등원만 하면 자율학습일 통과'가 되어 버립니다. 최소 1분은 남깁니다.
    perfectAttendanceDailyMinutes: Math.min(1440, Math.max(1, toInt(perfect.dailyMinutes, DEFAULT_POINT_AUTO_RULES.perfectAttendanceDailyMinutes))),
    perfectAttendanceRuleVersion: PERFECT_ATTENDANCE_RULE_VERSION,
    longAwayPenaltyEnabled: merged.longAwayPenaltyEnabled !== false,
    longAwayMinutes: Math.min(600, Math.max(5, toInt(merged.longAwayMinutes, DEFAULT_POINT_AUTO_RULES.longAwayMinutes))),
    longAwayPoints: Math.min(MAX_TIER_POINTS, Math.max(1, toInt(merged.longAwayPoints, DEFAULT_POINT_AUTO_RULES.longAwayPoints))),
  };
}

/**
 * v41-270: 저장된 주간 개근 설정이 옛 기준(v41-242)이면 새 기본값으로 올립니다.
 *
 * 옛 기준은 기본 0점·30분이라 저장본에 0·30 이 그대로 남아 있습니다. 그 값을 그대로 읽으면
 * 새 기준을 켜도 여전히 0점이라 아무도 못 받습니다. 저장본에 판 번호(2)가 없으면
 * 옛 저장본으로 보고, 점수는 0이면 5점으로, 분은 60분으로 맞춥니다.
 * 옛 저장본이라도 점수를 0이 아닌 값으로 직접 정해 두었다면 그 점수는 존중합니다.
 */
function upgradePerfectAttendanceRules(merged, raw) {
  // 기본값과 합친 뒤에는 판 번호가 항상 2라서, 저장본 원본에서 읽어야 합니다.
  const version = toInt(raw && typeof raw === 'object' ? raw.perfectAttendanceRuleVersion : undefined, 1);
  const storedPoints = toInt(merged.perfectAttendancePoints, 0);
  if (version >= PERFECT_ATTENDANCE_RULE_VERSION) {
    return { points: storedPoints, dailyMinutes: merged.perfectAttendanceDailyMinutes };
  }
  return {
    points: storedPoints > 0 ? storedPoints : DEFAULT_POINT_AUTO_RULES.perfectAttendancePoints,
    dailyMinutes: DEFAULT_POINT_AUTO_RULES.perfectAttendanceDailyMinutes,
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
 * v41-270: 기준을 "센터 운영일 전부 등원"에서 "개인 시간표 준수 + 차시 없는 날 자율학습"으로
 * 바꿨습니다. (부원장님 지시)
 *
 * 기준 — 월~일 7일을 전부 봅니다.
 *   A) 개인 시간표에 차시가 있는 날 (planned_check_in 이 있는 날)
 *      - 등원 기록이 있어야 합니다. 미등원 → 실패
 *      - 결석(seat_status absent) → 실패
 *      - 시간표에 결석으로 등록해 둔 날(planned_absent) → 실패. 사전 신고라도 결석은 결석입니다.
 *      - 지각: 실제 등원이 예정 등원 + 허용치(분)보다 늦으면 실패
 *      - 조기 외출: 예정 하원이 있고 실제 하원이 예정 하원 - 허용치보다 이르면 실패.
 *        하원 기록이 없는 날은 조기 외출로 보지 않습니다. (자동 하원 등으로 시각이 없을 수 있음)
 *   B) 차시가 없는 날 (시간표 행이 없거나 등원 시각이 비어 있는 날)
 *      일요일·공휴일뿐 아니라 그 학생의 빈 요일도 전부 여기 들어갑니다.
 *      - 그날 순공시간이 최소치(기본 60분) 이상이어야 합니다. 미만이면 실패
 *
 * 순공시간은 차시 있는 날에는 따로 보지 않습니다. 시간표대로 들어와 나간 것으로 충분합니다.
 *
 * @param {string[]} options.weekDates 그 주 날짜 7개 (YYYY-MM-DD). 비어 있으면 operatingDates 를 씁니다.
 * @returns {{ok, scheduledDays, freeDays, attendedDays, failures:[{date, reason, kind}]}}
 */
export function evaluatePerfectAttendance({
  weekDates = [],
  operatingDates = [],
  schedules = [],
  sessionsByDate = {},
  minutesByDate = {},
  dailyMinMinutes = DEFAULT_POINT_AUTO_RULES.perfectAttendanceDailyMinutes,
  lateThresholdMinutes = 1,
  earlyLeaveThresholdMinutes = null,
} = {}) {
  const source = Array.isArray(weekDates) && weekDates.length ? weekDates : operatingDates;
  const dates = [...new Set((Array.isArray(source) ? source : [])
    .map((value) => String(value || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();

  if (!dates.length) {
    return { ok: false, scheduledDays: 0, freeDays: 0, operatingDays: 0, attendedDays: 0, failures: [{ date: '', reason: '판정할 날짜 없음', kind: 'none' }] };
  }

  const lateAllow = Math.max(0, Number(lateThresholdMinutes || 0));
  const earlyAllow = earlyLeaveThresholdMinutes === null || earlyLeaveThresholdMinutes === undefined
    ? lateAllow
    : Math.max(0, Number(earlyLeaveThresholdMinutes || 0));

  // 날짜별 시간표. 같은 날 행이 둘이면 등원 시각이 있는 쪽을 우선합니다.
  const scheduleByDate = {};
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const date = String(schedule?.schedule_date || '').slice(0, 10);
    if (!date) continue;
    const plannedIn = timeStringToMinutes(schedule?.planned_check_in);
    const plannedOut = timeStringToMinutes(schedule?.planned_check_out);
    const entry = { plannedIn, plannedOut, plannedAbsent: Boolean(schedule?.planned_absent) };
    const existing = scheduleByDate[date];
    if (!existing || (existing.plannedIn === null && plannedIn !== null)) scheduleByDate[date] = entry;
  }

  const failures = [];
  let scheduledDays = 0;
  let freeDays = 0;
  let attendedDays = 0;

  for (const date of dates) {
    const schedule = scheduleByDate[date];
    const session = sessionsByDate[date];
    const hasSlot = Boolean(schedule && (schedule.plannedIn !== null || schedule.plannedAbsent));

    if (!hasSlot) {
      // B) 차시가 없는 날 — 자율학습 순공시간만 봅니다.
      freeDays += 1;
      const minutes = Number(minutesByDate[date] || 0);
      if (minutes < Number(dailyMinMinutes || 0)) {
        failures.push({ date, kind: 'free', reason: `자율학습 ${minutes}분 (최소 ${dailyMinMinutes}분)` });
        continue;
      }
      attendedDays += 1;
      continue;
    }

    // A) 차시가 있는 날 — 시간표를 그대로 지켰는지 봅니다.
    scheduledDays += 1;
    if (schedule.plannedAbsent) {
      failures.push({ date, kind: 'absent', reason: '결석(시간표 등록)' });
      continue;
    }
    if (!session || !session.check_in_at) {
      failures.push({ date, kind: 'absent', reason: '미등원' });
      continue;
    }
    if (session.seat_status === 'absent') {
      failures.push({ date, kind: 'absent', reason: '결석' });
      continue;
    }
    // 자정을 넘긴 하원(예: 00:10)은 1440분을 더한 값으로 비교해야 '조기 외출'로 잘못 잡히지 않습니다.
    const checkInMinute = isoToKstMinutesSinceDate(session.check_in_at, date);
    if (schedule.plannedIn !== null && checkInMinute !== null && checkInMinute > schedule.plannedIn + lateAllow) {
      failures.push({ date, kind: 'late', reason: `지각 (예정 ${minutesToClock(schedule.plannedIn)} · 실제 ${minutesToClock(checkInMinute)})` });
      continue;
    }
    const checkOutMinute = session.check_out_at ? isoToKstMinutesSinceDate(session.check_out_at, date) : null;
    if (schedule.plannedOut !== null && checkOutMinute !== null && checkOutMinute < schedule.plannedOut - earlyAllow) {
      failures.push({ date, kind: 'early', reason: `조기 외출 (예정 ${minutesToClock(schedule.plannedOut)} · 실제 ${minutesToClock(checkOutMinute)})` });
      continue;
    }
    attendedDays += 1;
  }

  return {
    ok: failures.length === 0 && attendedDays === dates.length,
    scheduledDays,
    freeDays,
    // 예전 호출부 호환: 판정한 날 수
    operatingDays: dates.length,
    attendedDays,
    failures,
  };
}

/** ISO 시각 → 기준 날짜(KST 자정)부터 지난 분. 다음날 00:10 이면 1450 입니다. */
export function isoToKstMinutesSinceDate(value, dateString) {
  if (!value) return null;
  const time = new Date(value).getTime();
  const base = new Date(`${String(dateString || '').slice(0, 10)}T00:00:00+09:00`).getTime();
  if (Number.isNaN(time) || Number.isNaN(base)) return isoToKstMinuteOfDay(value);
  return Math.round((time - base) / 60000);
}

function minutesToClock(minute) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return '--:--';
  const h = Math.floor(((value % 1440) + 1440) % 1440 / 60);
  const m = ((value % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
/**
 * v41-262: 연속 주 수 계산.
 *
 * 직전 스캔에서도 대상이었으면 이어서 세되, 설정한 연속 기준(streakWeeks, 기본 2주)에
 * 닿은 다음 주에는 1주부터 다시 셉니다. 2주 연속을 찍고 별도 상품 대상이 된 뒤,
 * 그 다음 주에 또 넘으면 [3주 연속]이 아니라 새 사이클의 [1주]입니다.
 *
 *   주차:   1  2  3  4  5      (매주 기준 초과)
 *   예전:   1  2  3  4  5      → 3주부터 계속 '연속' 표시
 *   지금:   1  2  1  2  1      → 2주마다 한 번씩 별도 상품 대상
 *
 * 중간에 한 주라도 기준에 못 미치면 0 으로 끊기고, 다음에 넘으면 1 부터입니다.
 */
export function resolveStreakWeeks(previousScan, isEligible, streakWeeks = DEFAULT_POINT_AUTO_RULES.streakWeeks) {
  if (!isEligible) return 0;
  const target = Math.max(2, Math.round(Number(streakWeeks) || DEFAULT_POINT_AUTO_RULES.streakWeeks));
  const prev = previousScan?.is_eligible ? Math.max(0, Math.round(Number(previousScan.streak_weeks || 1))) : 0;
  if (prev >= target) return 1;
  return prev + 1;
}

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
