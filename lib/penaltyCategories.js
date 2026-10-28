// Beyond OS v41-280
// 벌점 카테고리(기본 점수)와 사유 문구 조립. 클라이언트·서버 공용입니다.
//
// 저장 규칙
//   student_points.reason        = "카테고리 · 상세 사유" (리포트·알림톡·랭킹 등 기존 소비자가 그대로 읽습니다)
//   student_points.category      = 카테고리 이름 (v41-280 SQL 실행 후 저장, 없으면 생략)
//   student_points.reason_detail = 상세 사유 (위와 같음)

export const CUSTOM_PENALTY_CATEGORY_KEY = 'custom';

export const PENALTY_CATEGORIES = [
  { key: 'attitude', label: '학습 자세 불량', points: 2 },
  { key: 'drowsy', label: '졸음', points: 2 },
  { key: 'schedule_change_before', label: '당일 일정 변경(입실 전)', points: 1 },
  { key: 'schedule_change_after', label: '당일 일정 변경(입실 후)', points: 3 },
  { key: 'late', label: '지각', points: 3 },
  { key: 'unauthorized_away', label: '무단외출', points: 5 },
  { key: 'late_period_entry', label: '차시 시작 후 입실', points: 2 },
  { key: 'seat_move', label: '지정 좌석 외 이동', points: 2 },
  { key: 'kiosk_missing', label: '키오스크 미입력', points: 2 },
  { key: 'long_away_self_study', label: '자율학습 중 장시간 외출', points: 3 },
  { key: 'unauthorized_leave_absence', label: '무단 조퇴 / 무단 결석', points: 10 },
  { key: 'proxy_attendance', label: '대리 출석 입력, 비회원 동반 입장', points: 10 },
  { key: 'noise', label: '생활소음', points: 2 },
  { key: 'eating', label: '학습실 내 취식', points: 2 },
  { key: 'untidy_seat', label: '자리 미정돈', points: 2 },
  { key: 'gathering', label: '2인 이상 집합, 대화', points: 2 },
  { key: 'disturbing', label: '타 학생 학습 방해', points: 5 },
  { key: 'break_disorder', label: '쉬는 시간, 식사 시간 소란 행위', points: 2 },
  { key: 'tablet_misuse', label: '태블릿 학습 외 사용', points: 10 },
  { key: 'external_network', label: '외부 회선, 테더링 사용', points: 5 },
  { key: 'music_unapproved', label: '음악 청취(사전 미승인)', points: 5 },
  { key: 'phone_rule', label: '휴대폰 이용 규정 미준수', points: 5 },
  { key: CUSTOM_PENALTY_CATEGORY_KEY, label: '사용자 입력', points: null },
];

export function getPenaltyCategory(key) {
  return PENALTY_CATEGORIES.find((item) => item.key === String(key || '')) || null;
}

export function isCustomPenaltyCategory(key) {
  return String(key || '') === CUSTOM_PENALTY_CATEGORY_KEY;
}

/**
 * 카테고리 선택값과 상세 사유로 저장용 문구를 만듭니다.
 * @returns {{ ok, error, category, detail, reason }}
 */
export function buildPenaltyReason({ categoryKey, customLabel = '', detail = '' } = {}) {
  const found = getPenaltyCategory(categoryKey);
  const cleanDetail = String(detail || '').trim().slice(0, 200);
  if (!found) return { ok: false, error: '벌점 카테고리를 선택하세요.', category: '', detail: cleanDetail, reason: '' };
  const category = isCustomPenaltyCategory(categoryKey)
    ? String(customLabel || '').trim().slice(0, 60)
    : found.label;
  if (!category) return { ok: false, error: '사용자 입력 카테고리의 사유 이름을 적어 주세요.', category: '', detail: cleanDetail, reason: '' };
  const reason = cleanDetail ? `${category} · ${cleanDetail}` : category;
  return { ok: true, error: '', category, detail: cleanDetail, reason };
}

/** 카테고리의 기본 점수 (사용자 입력은 null) */
export function getPenaltyCategoryDefaultPoints(key) {
  const found = getPenaltyCategory(key);
  return found && Number.isFinite(found.points) ? found.points : null;
}
