// Beyond OS v41-225 — 주간면담 내용이 사람이 쓴 것인지 자동 생성분인지 구분
//
// 위클리 리포트를 자동 구성할 때, 관리자가 [위클리 상담 내용]을 아직 쓰지
// 않았으면 학부모 화면이 비지 않도록 코드가 만든 요약 문장을 대신 넣습니다.
// (v41-126 에서 '주간 총평'을 주간면담 내용으로 통합하면서 생긴 동작입니다)
//
// 그 결과 학부모는 자동 요약을 '주간면담 내용'이라는 제목으로 보게 됩니다.
// 실제로 면담한 기록이 아닌데 면담한 것처럼 읽히므로 제목을 나눕니다.
//
//   사람이 쓴 것   → 주간면담 내용
//   자동 생성분    → 주간 Summary
//
// 어떻게 구분하는가
//   final_weekly_comment 칸에는 자동 생성 문장이 항상 저장됩니다.
//   director_interview 가 그것과 글자까지 같으면 아무도 손대지 않은 자동
//   초안입니다. 관리자가 한 글자라도 고치면 둘이 달라집니다.
//
//   이 방식이라 이미 만들어진 리포트에도 그대로 적용됩니다. 별도 표시용
//   컬럼을 두면 지난 리포트는 값이 없어 판별하지 못하고, 상담 내용만 따로
//   저장하는 경로(save_interview)에서 표시를 갱신하지 않으면 어긋납니다.
//
// 판단이 서지 않을 때는 '주간면담 내용'으로 둡니다.
// 사람이 쓴 면담 기록에 'Summary' 제목이 붙는 쪽이 그 반대보다 나쁩니다.

export const WEEKLY_INTERVIEW_TITLE = '주간면담 내용';
export const WEEKLY_SUMMARY_TITLE = '주간 Summary';

export function isAutoComposedInterview({ interview, finalComment } = {}) {
  const text = String(interview || '').trim();
  if (!text) return false;
  const auto = String(finalComment || '').trim();
  return Boolean(auto) && text === auto;
}

export function getWeeklyInterviewTitle({ interview, finalComment } = {}) {
  return isAutoComposedInterview({ interview, finalComment })
    ? WEEKLY_SUMMARY_TITLE
    : WEEKLY_INTERVIEW_TITLE;
}
