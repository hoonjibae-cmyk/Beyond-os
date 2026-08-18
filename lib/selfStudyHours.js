// Beyond OS v41-196 — 자율학습 시간대
//
// 정규 운영이 끝난 뒤에도 학습실을 열어 두는 시간입니다.
// 이 시간에는 개인 시간표를 미리 정해 두지 않고 학생이 자유롭게 오갑니다.
//
// 학부모에게 보내는 시간표에 하원 시각만 적으면 "그 시각에 문을 닫는다"로 읽히기 때문에,
// 요일 유형별로 이 시간대를 함께 표기합니다.
//
// 요일 유형은 설정 · 기본 시간표의 판정(평일 / 토요일 / 일요일 / 공휴일)을 그대로 씁니다.
// 운영 시간이 바뀌면 이 값만 고치면 화면과 이미지에 함께 반영됩니다.
export const SELF_STUDY_WINDOWS = {
  weekday: { start: '22:30', end: '24:00' },
  saturday: { start: '18:30', end: '22:00' },
  sunday: { start: '09:30', end: '22:00' },
  // 공휴일은 운영하지 않으므로 자율학습도 없습니다.
  holiday: null,
};

export function getSelfStudyWindow(dayType) {
  const window = SELF_STUDY_WINDOWS[dayType];
  return window && window.start && window.end ? window : null;
}

export function formatSelfStudyWindow(dayType) {
  const window = getSelfStudyWindow(dayType);
  return window ? `${window.start}~${window.end}` : '';
}

// 안내 문구 한 줄. (이미지 하단, 학부모 확인 화면에서 함께 씁니다)
export function describeSelfStudyWindows() {
  const parts = [];
  if (SELF_STUDY_WINDOWS.weekday) parts.push(`평일 ${formatSelfStudyWindow('weekday')}`);
  if (SELF_STUDY_WINDOWS.saturday) parts.push(`토요일 ${formatSelfStudyWindow('saturday')}`);
  if (SELF_STUDY_WINDOWS.sunday) parts.push(`일요일 ${formatSelfStudyWindow('sunday')}`);
  return parts.join(' · ');
}
