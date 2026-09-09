// Beyond OS v41-244 — 공지 알림톡 수신 대상(학부모 / 학생) — 클라이언트·서버 공용
//
// 지금까지 공지는 보호자에게만 나갔습니다. 운영시간 변동처럼 학생 본인이 바로
// 알아야 하는 안내가 있어 대상을 고를 수 있게 했습니다.
//
// 기본값은 'parent' 입니다. 고르지 않고 보내면 예전과 똑같이 학부모에게만 갑니다.

export const NOTICE_AUDIENCES = [
  { key: 'parent', label: '학부모', desc: '수신 동의된 보호자에게만 보냅니다. (기존 방식)' },
  { key: 'student', label: '학생', desc: '학생 본인 연락처로만 보냅니다.' },
  { key: 'both', label: '학부모 + 학생', desc: '보호자와 학생 본인 모두에게 보냅니다. 같은 번호는 한 번만 갑니다.' },
];

export const DEFAULT_NOTICE_AUDIENCE = 'parent';

const AUDIENCE_KEYS = new Set(NOTICE_AUDIENCES.map((item) => item.key));

export function normalizeNoticeAudience(value) {
  const key = String(value || '').trim();
  return AUDIENCE_KEYS.has(key) ? key : DEFAULT_NOTICE_AUDIENCE;
}

export function getNoticeAudience(value) {
  const key = normalizeNoticeAudience(value);
  return NOTICE_AUDIENCES.find((item) => item.key === key);
}

export function getNoticeAudienceLabel(value) {
  return getNoticeAudience(value).label;
}

export function audienceIncludesParent(value) {
  return normalizeNoticeAudience(value) !== 'student';
}

export function audienceIncludesStudent(value) {
  return normalizeNoticeAudience(value) !== 'parent';
}
