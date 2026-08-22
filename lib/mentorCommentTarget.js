// Beyond OS v41-222 — 학습멘토 코멘트를 어느 리포트에 실을지
//
// 코멘트를 적는 자리(학습 관리 화면의 [오늘 학습멘토 코멘트])는 그대로입니다.
// 바뀌는 것은 그 내용이 학부모에게 어느 리포트로 나가는지뿐입니다.
//
//   daily    데일리 리포트에 그날 코멘트를 싣습니다. (매일 멘토링하는 운영)
//   weekly   위클리 리포트에 그 주 코멘트를 날짜와 함께 모아 싣습니다.
//            (주 1회 멘토링. 데일리에는 코멘트 칸이 나오지 않습니다)
//
// 왜 값을 지우는 선택지를 두지 않았나
//   코멘트는 이미 저장된 기록입니다. 어디에 실을지만 고르는 설정이라
//   '아무 데도 안 실음'은 기록을 숨기는 것이라 넣지 않았습니다.
//
// 저장 위치: system_settings 의 operating_rules JSON 안 mentorCommentTarget.
// (JSON 이라 컬럼 추가 없이 들어갑니다. SQL 실행이 필요 없습니다)

export const DEFAULT_MENTOR_COMMENT_TARGET = 'daily';

export const MENTOR_COMMENT_TARGETS = [
  {
    key: 'daily',
    label: '데일리 리포트',
    detail: '그날 적은 코멘트를 그날 데일리 리포트에 싣습니다. 매일 멘토링하는 기수에 맞습니다.',
  },
  {
    key: 'weekly',
    label: '위클리 리포트',
    detail: '그 주에 적은 코멘트를 날짜와 함께 모아 위클리 리포트에 싣습니다. 주 1회 멘토링하는 기수에 맞습니다. 데일리 리포트에는 코멘트 칸이 나오지 않습니다.',
  },
];

export const MENTOR_COMMENT_TARGET_KEYS = MENTOR_COMMENT_TARGETS.map((item) => item.key);

export function normalizeMentorCommentTarget(value) {
  const raw = String(value || '').trim().toLowerCase();
  return MENTOR_COMMENT_TARGET_KEYS.includes(raw) ? raw : DEFAULT_MENTOR_COMMENT_TARGET;
}

export function getMentorCommentTarget(value) {
  const key = normalizeMentorCommentTarget(value);
  return MENTOR_COMMENT_TARGETS.find((item) => item.key === key);
}

export function getMentorCommentTargetLabel(value) {
  return getMentorCommentTarget(value).label;
}
