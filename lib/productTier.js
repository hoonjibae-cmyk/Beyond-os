// Beyond OS v41-167
// 학생 신청 상품 카테고리입니다.
//
//   Lite    기본 상품 — 자리만 제공 (멘토링·학습 코칭 없음)
//   Plus    Lite + 학습 코칭
//   Premium Plus + 수행평가
//
// 1기 학생처럼 값이 없는 경우는 '미분류'로 두고 화면에 아무 표시도 하지 않습니다.
// (기존 화면이 그대로 보이게 하기 위함)

export const PRODUCT_TIERS = [
  {
    key: 'lite',
    label: 'Lite',
    short: 'L',
    summary: '자리만 제공',
    detail: '기본 상품. 별도의 멘토링·학습 코칭이 없습니다.',
    hasCoaching: false,
    hasAssessment: false,
  },
  {
    key: 'plus',
    label: 'Plus',
    short: 'P',
    summary: 'Lite + 학습 코칭',
    detail: '자리 제공에 학습 코칭이 더해집니다.',
    hasCoaching: true,
    hasAssessment: false,
  },
  {
    key: 'premium',
    label: 'Premium',
    short: 'PR',
    summary: 'Plus + 수행평가',
    detail: '학습 코칭에 수행평가 관리가 더해집니다.',
    hasCoaching: true,
    hasAssessment: true,
  },
];

export const PRODUCT_TIER_KEYS = PRODUCT_TIERS.map((item) => item.key);

export function normalizeProductTier(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PRODUCT_TIER_KEYS.includes(raw) ? raw : '';
}

export function getProductTier(value) {
  const key = normalizeProductTier(value);
  return key ? PRODUCT_TIERS.find((item) => item.key === key) : null;
}

// 화면 표기용 라벨. 미분류면 빈 문자열이라 아무것도 그리지 않습니다.
export function getProductTierLabel(value) {
  return getProductTier(value)?.label || '';
}

// 이 학생이 학습 코칭/멘토링 대상인지. 미분류는 판단하지 않고 true로 둡니다.
// (1기 학생은 카테고리가 없으므로 예전처럼 모두 대상입니다)
export function isCoachingTier(value) {
  const tier = getProductTier(value);
  return tier ? tier.hasCoaching : true;
}

export function isAssessmentTier(value) {
  const tier = getProductTier(value);
  return tier ? tier.hasAssessment : true;
}
