// Beyond OS v41-238 — 순찰 때 매기는 집중도 (별 1~5)
//
// 순찰하며 학습 상태를 체크할 때 함께 별점을 남깁니다. 하루치를 평균 내
// '오늘의 집중도 OO%' 로 보여 줍니다.
//
//   ★1 20%   ★2 40%   ★3 60%   ★4 80%   ★5 100%
//
// 0(=별점 없음)과 낮은 별점을 반드시 구분해야 합니다. 0 을 '집중도 0%' 로
// 세면 별점을 안 매긴 체크가 평균을 끌어내립니다. 그래서 별점이 없는 체크는
// 평균에서 아예 뺍니다.

export const FOCUS_MAX = 5;

export const FOCUS_LABELS = {
  1: '많이 흐트러짐',
  2: '흐트러짐',
  3: '보통',
  4: '집중',
  5: '매우 집중',
};

export function normalizeFocusRating(value) {
  const raw = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(raw) || raw < 1 || raw > FOCUS_MAX) return 0;
  return raw;
}

export function getFocusLabel(value) {
  const rating = normalizeFocusRating(value);
  return rating ? FOCUS_LABELS[rating] : '';
}

/**
 * 하루치 체크에서 집중도 평균을 냅니다.
 *
 * @param {Array} rows study_checks 행 (focus_rating 을 가진 것)
 * @returns {{ percent: number|null, average: number|null, count: number }}
 *          percent 는 별점이 하나도 없으면 null 입니다. (0% 와 구분)
 */
export function summarizeFocusRatings(rows = []) {
  const ratings = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeFocusRating(row?.focus_rating))
    .filter((rating) => rating > 0);
  if (!ratings.length) return { percent: null, average: null, count: 0 };
  const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return {
    percent: Math.round((average / FOCUS_MAX) * 100),
    average: Math.round(average * 10) / 10,
    count: ratings.length,
  };
}
