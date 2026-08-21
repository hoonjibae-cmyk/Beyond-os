// Beyond OS v41-216 — 학생별 음악 청취 허용 범위
//
// 학부모가 세 단계 중 하나를 정합니다. 현장에서 순찰할 때 판단 기준이 됩니다.
//
//   none      이어폰 사용 불가        — 귀에 아무것도 꽂지 않습니다.
//   noise     노이즈 캔슬링 허용      — 소음 차단만. 소리를 재생하면 안 됩니다.
//   music     음악·백색소음 허용      — 소리를 들으며 공부해도 됩니다.
//
// 값이 없는 학생(기존 학생 · 아직 안 정한 학생)은 '미정'으로 두고 화면에 표시하지 않습니다.
// 여기서 임의로 기본값을 정하면, 정하지 않은 것과 허용한 것을 구분할 수 없게 됩니다.

export const AUDIO_POLICIES = [
  {
    key: 'none',
    label: '이어폰 사용 불가',
    short: '이어폰 불가',
    detail: '이어폰·헤드폰을 착용하지 않습니다.',
    // 순찰 화면에서 눈에 띄어야 하는 정도. 제한이 셀수록 강하게 표시합니다.
    tone: 'block',
  },
  {
    key: 'noise',
    label: '노이즈 캔슬링 허용',
    short: '노캔만',
    detail: '소음 차단 목적의 착용만 허용합니다. 음악 재생은 안 됩니다.',
    tone: 'limit',
  },
  {
    key: 'music',
    label: '음악·백색소음 허용',
    short: '음악 허용',
    detail: '음악이나 백색소음을 들으며 공부해도 됩니다.',
    tone: 'allow',
  },
];

export const AUDIO_POLICY_KEYS = AUDIO_POLICIES.map((item) => item.key);

export function normalizeAudioPolicy(value) {
  const raw = String(value || '').trim().toLowerCase();
  return AUDIO_POLICY_KEYS.includes(raw) ? raw : '';
}

export function getAudioPolicy(value) {
  const key = normalizeAudioPolicy(value);
  return key ? AUDIO_POLICIES.find((item) => item.key === key) : null;
}

// 화면 표기용. 미정이면 빈 문자열이라 아무것도 그리지 않습니다.
export function getAudioPolicyLabel(value) {
  return getAudioPolicy(value)?.label || '';
}

export function getAudioPolicyShort(value) {
  return getAudioPolicy(value)?.short || '';
}
