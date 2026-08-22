// Beyond OS v41-224 — 데일리 플래너 사진을 어느 리포트에 실을지
//
// 사진을 올리는 자리(데일리 플래너 업로드 화면)는 그대로입니다.
// 바뀌는 것은 그 사진이 학부모에게 어느 리포트로 나가는지뿐입니다.
//
//   daily    그날 올린 사진을 그날 데일리 리포트에 싣습니다.
//   weekly   그 주에 올린 사진을 날짜와 함께 모아 위클리 리포트에 싣습니다.
//            (데일리 리포트에는 플래너 칸이 나오지 않습니다)
//
// lib/mentorCommentTarget.js 와 같은 모양입니다. 둘 다 '어느 리포트에
// 싣는가'를 고르는 설정이라 구조를 일부러 맞췄습니다. 세 번째가 생기면
// 하나로 합치는 편이 낫습니다.
//
// 저장 위치: system_settings 의 operating_rules JSON 안 plannerImageTarget.
// (JSON 이라 컬럼 추가 없이 들어갑니다. SQL 실행이 필요 없습니다)

export const DEFAULT_PLANNER_IMAGE_TARGET = 'daily';

export const PLANNER_IMAGE_TARGETS = [
  {
    key: 'daily',
    label: '데일리 리포트',
    detail: '그날 올린 플래너 사진을 그날 데일리 리포트에 싣습니다.',
  },
  {
    key: 'weekly',
    label: '위클리 리포트',
    detail: '그 주에 올린 플래너 사진을 날짜와 함께 모아 위클리 리포트에 싣습니다. 데일리 리포트에는 플래너 칸이 나오지 않습니다.',
  },
];

export const PLANNER_IMAGE_TARGET_KEYS = PLANNER_IMAGE_TARGETS.map((item) => item.key);

export function normalizePlannerImageTarget(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLANNER_IMAGE_TARGET_KEYS.includes(raw) ? raw : DEFAULT_PLANNER_IMAGE_TARGET;
}

export function getPlannerImageTarget(value) {
  const key = normalizePlannerImageTarget(value);
  return PLANNER_IMAGE_TARGETS.find((item) => item.key === key);
}

export function getPlannerImageTargetLabel(value) {
  return getPlannerImageTarget(value).label;
}
