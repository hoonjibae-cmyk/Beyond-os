// Beyond OS v41-164
// 학생 랭킹보드 닉네임 자동 생성 모듈입니다.
//
// 1기 때 관리자가 손으로 붙였던 닉네임을 그대로 본떴습니다.
//   디딤 · 깊이 · 차오름 · 오늘도 · 집중 · 한결같이 · 오름길 · 발자취 · 넘어서
//   묵묵함 · 매일 · 깨침 · 몰입 · 한 걸음 · 배움 · 다시 · 성실함 · 버팀 · 성장
//   나아감 · 다짐 · 나아짐 · 이어감 · 또렷함 · 채움 · 꾸준함
//
// 공통점
//   - 순우리말 중심, 2~4자
//   - 학습 태도(꾸준함·집중·성장)를 담백하게 이르는 말
//   - 사람을 놀리거나 웃기려는 말이 하나도 없음
//
// 그래서 형태소를 조합해 만들지 않고 "쓸 수 있는 말"만 손으로 골라 두었습니다.
// 조합식으로 만들면 어법이 어긋나거나 우스운 말이 섞여 나오는데,
// 닉네임은 학생 본인에게 계속 붙는 이름이라 그런 사고가 나면 안 됩니다.

// ── 후보 목록 ────────────────────────────────────────────────
// 1기 실제 닉네임과 같은 결의 말만 담습니다. 길이 2~4자.

// 명사형 (디딤 · 배움 · 채움 계열)
const NOUN_FORMS = [
  '디딤', '배움', '채움', '버팀', '다짐', '깨침', '깊이', '몰입', '집중', '성장',
  '오름', '지음', '쌓음', '이룸', '가꿈', '메움', '돋움', '새김', '익힘', '견딤',
  '넓힘', '키움', '늘림', '고름', '여묾', '붙듦', '뚝심', '끈기', '자국', '보탬',
  '다독임', '두드림', '끌어냄', '북돋움', '다잡음', '이겨냄', '헤쳐냄', '풀어냄', '깨어남', '나아감',
  '나아짐', '이어감', '올라섬', '차오름', '피어남', '자라남', '깊어짐', '밝아짐', '내디딤', '발돋움',
  '단단해짐', '넉넉함',
];

// 성질을 이르는 말 (-함 · -음 계열)
const QUALITY_FORMS = [
  '꾸준함', '성실함', '또렷함', '묵묵함', '올곧음', '차분함', '단단함', '깔끔함', '야무짐', '당참',
  '굳건함', '진득함', '고요함', '단정함', '차근함', '단호함', '느긋함', '똑바름', '반듯함', '든든함',
  '한결같음', '한결같이', '빈틈없음', '한마음',
];

// 길 · 자취를 이르는 말
const PATH_FORMS = [
  '오름길', '발자취', '한 걸음', '첫 걸음', '한 줄', '한 뼘', '디딤돌', '길목', '이정표', '걸음마다',
  '발걸음', '오늘 한 칸', '한 계단',
];

// 때를 이르는 말 (매일 · 다시 · 오늘도 계열)
const TIME_FORMS = [
  '매일', '다시', '오늘도', '하루하루', '오늘부터', '내일도', '언제나', '아침마다', '날마다', '한결',
  '여전히', '오늘 하루', '또 하루', '지금부터', '하루치',
];

// 넘어서는 힘을 이르는 말
const OVERCOME_FORMS = [
  '넘어서', '이겨내', '버텨내', '해내', '한번 더', '끝까지', '포기없이', '일어섬', '버텨냄', '넘어섬',
];

export const NICKNAME_POOLS = {
  noun: NOUN_FORMS,
  quality: QUALITY_FORMS,
  path: PATH_FORMS,
  time: TIME_FORMS,
  overcome: OVERCOME_FORMS,
};

export const NICKNAME_POOL = [
  ...NOUN_FORMS, ...QUALITY_FORMS, ...PATH_FORMS, ...TIME_FORMS, ...OVERCOME_FORMS,
];

// 1기 닉네임 길이 분포(2~4자)에 맞춥니다. 공백은 길이에서 빼고 셉니다.
export const MIN_LENGTH = 2;
export const MAX_LENGTH = 4;

export function nicknameLength(value) {
  return String(value || '').replace(/\s/g, '').length;
}

// 비교용 정규화: 공백을 지우고 맞춰 봅니다. ("한 걸음"과 "한걸음"은 같은 이름)
export function normalizeNickname(value) {
  return String(value || '').replace(/\s/g, '').trim();
}

/**
 * 쓸 수 있는 후보만 남깁니다.
 * @param {string[]} taken 이미 쓰고 있는 닉네임
 */
export function getAvailableNicknames(taken = [], options = {}) {
  const { minLength = MIN_LENGTH, maxLength = MAX_LENGTH } = options;
  const used = new Set((taken || []).map(normalizeNickname).filter(Boolean));
  return NICKNAME_POOL.filter((item) => {
    if (used.has(normalizeNickname(item))) return false;
    const length = nicknameLength(item);
    return length >= minLength && length <= maxLength;
  });
}

function pickRandom(list, random = Math.random) {
  if (!list.length) return '';
  return list[Math.floor(random() * list.length)];
}

/**
 * 닉네임 하나를 뽑습니다. 이미 쓰는 이름은 피합니다.
 * @returns {{ok:boolean, nickname?:string, error?:string, remaining:number}}
 */
export function generateNickname(taken = [], options = {}) {
  const { exclude = [], random = Math.random } = options;
  const excludeSet = new Set([...(exclude || [])].map(normalizeNickname).filter(Boolean));
  const available = getAvailableNicknames(taken, options)
    .filter((item) => !excludeSet.has(normalizeNickname(item)));

  if (!available.length) {
    return {
      ok: false,
      remaining: 0,
      error: '더 쓸 수 있는 닉네임이 없습니다. 기존 닉네임을 정리하거나 직접 입력해 주세요.',
    };
  }

  return { ok: true, nickname: pickRandom(available, random), remaining: available.length };
}

/**
 * 여러 학생에게 한 번에 배정합니다. 서로 겹치지 않게 뽑습니다.
 * @param {Array} students [{id, name}]
 * @param {string[]} taken 이미 쓰고 있는 닉네임
 * @returns {{assignments: Array<{id,name,nickname}>, unassigned: Array, remaining:number}}
 */
export function generateNicknamesForStudents(students = [], taken = [], options = {}) {
  const { random = Math.random } = options;
  const pool = getAvailableNicknames(taken, options);

  // 순서에 따라 앞사람이 좋은 이름을 다 가져가지 않도록 섞어서 나눠 줍니다.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const assignments = [];
  const unassigned = [];
  for (const student of students || []) {
    const nickname = shuffled.pop();
    if (!nickname) { unassigned.push(student); continue; }
    assignments.push({ id: student.id, name: student.name, nickname });
  }

  return { assignments, unassigned, remaining: shuffled.length };
}
