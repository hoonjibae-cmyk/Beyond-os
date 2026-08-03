// Beyond OS v41-137
// 상벌점 "사이클" 계산 공용 모듈입니다.
//
// 운영 규칙
//   1) 순점수(상점 - 벌점)가 기준점(기본 10점)을 초과하면(= 11점부터) 상품 지급 대상 알림이 뜹니다.
//   2) [상품지급안내완료]를 누르면 그 시점 이후로 카운팅을 0부터 다시 시작합니다(리셋).
//      상벌점 원본 기록은 지우지 않고 그대로 보관하며, 지급 이력만 따로 남깁니다.
//   3) [미지급]을 누르면 리셋 없이 계속 누적하되, 그 시점 대비 순점수가 추가로 기준점을
//      초과할 때까지 알림을 다시 띄우지 않습니다.
//      (예: 11점에서 미지급 → 22점이 되면 다시 알림)

export const POINT_REWARD_THRESHOLD = 10;

export function summarizePointRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const reward = list
    .filter((row) => row.point_type === 'reward')
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = list
    .filter((row) => row.point_type !== 'reward')
    .reduce((sum, row) => sum + Number(row.points || 0), 0);
  return { reward, penalty, net: reward - penalty, count: list.length };
}

function toTime(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

// 상벌점 한 건의 기준 시각. created_at이 없으면 point_date를 사용합니다.
function getPointRowTime(row = {}) {
  if (row.created_at) return toTime(row.created_at);
  if (row.point_date) return toTime(`${row.point_date}T23:59:59+09:00`);
  return 0;
}

/**
 * 한 학생의 상벌점 사이클 상태를 계산합니다.
 *
 * @param {Array} pointRows   student_points 행 (삭제되지 않은 것)
 * @param {Array} rewardRows  student_point_rewards 행 (지급/미지급 이력)
 * @param {Object} options    { threshold, asOf } asOf 이후의 기록은 무시합니다(리포트 시점 고정용)
 */
export function resolvePointCycle(pointRows = [], rewardRows = [], options = {}) {
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : POINT_REWARD_THRESHOLD;
  const asOfTime = options.asOf ? toTime(options.asOf) : Infinity;

  const points = (Array.isArray(pointRows) ? pointRows : [])
    .filter((row) => row && row.is_deleted !== true)
    .filter((row) => getPointRowTime(row) <= asOfTime);

  const history = (Array.isArray(rewardRows) ? rewardRows : [])
    .filter((row) => row && toTime(row.created_at) <= asOfTime)
    .sort((a, b) => toTime(a.created_at) - toTime(b.created_at));

  const grants = history.filter((row) => row.action === 'granted');
  const lastGrant = grants.length ? grants[grants.length - 1] : null;
  const cycleStartTime = lastGrant ? toTime(lastGrant.created_at) : 0;

  // 현재 사이클(마지막 지급 이후)에 쌓인 상벌점만 카운팅합니다.
  const cycleRows = points.filter((row) => getPointRowTime(row) > cycleStartTime);
  const cycle = summarizePointRows(cycleRows);
  const lifetime = summarizePointRows(points);

  // 같은 사이클 안에서의 마지막 '미지급' 처리 시점 순점수를 기준선으로 삼습니다.
  const deferralsInCycle = history.filter((row) => row.action === 'deferred' && toTime(row.created_at) > cycleStartTime);
  const lastDeferral = deferralsInCycle.length ? deferralsInCycle[deferralsInCycle.length - 1] : null;
  const deferredNet = lastDeferral ? Number(lastDeferral.net_points || 0) : 0;

  const alertBaseline = deferredNet > 0 ? deferredNet : 0;
  const eligible = cycle.net - alertBaseline > threshold;
  const nextTargetNet = alertBaseline + threshold + 1;

  return {
    threshold,
    cycleStartAt: lastGrant?.created_at || null,
    cycleRows,
    reward: cycle.reward,
    penalty: cycle.penalty,
    net: cycle.net,
    count: cycle.count,
    lifetime,
    grants,
    grantCount: grants.length,
    lastGrant,
    lastDeferral,
    deferredNet,
    eligible,
    // 알림이 다시 뜨기까지 남은 점수 (이미 대상이면 0)
    remainingToTarget: eligible ? 0 : Math.max(0, nextTargetNet - cycle.net),
    nextTargetNet,
    alertMessage: eligible ? `상벌점 누적 ${threshold}점 초과하여 상품 지급 대상입니다` : '',
  };
}

// 여러 학생을 한 번에 계산합니다. pointRows/rewardRows는 전체 목록을 넘기면 됩니다.
export function resolvePointCyclesByStudent(pointRows = [], rewardRows = [], options = {}) {
  const pointsByStudent = new Map();
  for (const row of pointRows || []) {
    const key = String(row.student_id || '');
    if (!key) continue;
    if (!pointsByStudent.has(key)) pointsByStudent.set(key, []);
    pointsByStudent.get(key).push(row);
  }

  const rewardsByStudent = new Map();
  for (const row of rewardRows || []) {
    const key = String(row.student_id || '');
    if (!key) continue;
    if (!rewardsByStudent.has(key)) rewardsByStudent.set(key, []);
    rewardsByStudent.get(key).push(row);
  }

  const result = {};
  const keys = new Set([...pointsByStudent.keys(), ...rewardsByStudent.keys()]);
  for (const key of keys) {
    result[key] = resolvePointCycle(pointsByStudent.get(key) || [], rewardsByStudent.get(key) || [], options);
  }
  return result;
}

// 지급 이력 한 줄 표기: "2026-08-03 상품 지급 (당시 순점수 +11점 · 상 15 / 벌 4)"
export function formatPointGrantLine(grant = {}) {
  if (!grant) return '';
  const date = String(grant.created_at || '').slice(0, 10);
  const net = Number(grant.net_points || 0);
  const reward = Number(grant.reward_points || 0);
  const penalty = Number(grant.penalty_points || 0);
  return `${date} 상품 지급 (당시 순점수 ${net > 0 ? '+' : ''}${net}점 · 상 ${reward} / 벌 ${penalty})`;
}
