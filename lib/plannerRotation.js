// Beyond OS v41-235 — 플래너 사진 회전값
//
// 업로드할 때 이미 사진 자체를 돌려서 저장합니다(v41-226). 이 값은 그 뒤에
// "이미 올라간 사진이 누워 있더라"를 발견했을 때 쓰는 사후 보정용입니다.
//
// 사진 파일을 다시 만들지 않고 각도만 저장하는 이유
//   리포트는 열어 볼 때마다 저장된 사진을 그립니다. 각도만 따로 두면
//   이미 발송한 링크도 다음에 열 때 바로 선 사진으로 보입니다.
//   파일을 다시 만들면 이미 나간 리포트는 고칠 방법이 없습니다.
//
// 시계 방향 각도이며 0 / 90 / 180 / 270 만 씁니다.

export const PLANNER_ROTATIONS = [0, 90, 180, 270];

export function normalizePlannerRotation(value) {
  const raw = Math.trunc(Number(value) || 0);
  const deg = ((raw % 360) + 360) % 360;
  return PLANNER_ROTATIONS.includes(deg) ? deg : 0;
}

export function turnPlannerRotation(value, step) {
  return normalizePlannerRotation(normalizePlannerRotation(value) + step);
}

// 90°/270° 로 돌리면 가로세로가 바뀝니다. 화면에서 상자 크기를 정할 때 씁니다.
export function isPlannerRotationSideways(value) {
  const deg = normalizePlannerRotation(value);
  return deg === 90 || deg === 270;
}
