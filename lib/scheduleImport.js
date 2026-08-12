// Beyond OS v41-149
// 설문(구글폼 등) 응답 엑셀 → 학생 개인 시간표 일괄 등록용 파싱/매핑 모듈입니다.
//
// 설문 양식은 기수마다 바뀔 수 있으므로 컬럼 이름을 고정하지 않습니다.
// 업로드한 파일의 헤더를 읽어 "이 컬럼은 월요일 등원시간" 식으로 사용자가 연결(매핑)하고,
// 그 매핑대로 요일별 등하원 패턴을 만들어 기간 내 날짜에 펼쳐 넣습니다.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS = {
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
};

// JS Date.getDay() (0=일) → 요일 키
export const DAY_INDEX_TO_KEY = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

const DAY_ALIASES = {
  mon: ['월요일', '월', 'mon', 'monday'],
  tue: ['화요일', '화', 'tue', 'tuesday'],
  wed: ['수요일', '수', 'wed', 'wednesday'],
  thu: ['목요일', '목', 'thu', 'thursday'],
  fri: ['금요일', '금', 'fri', 'friday'],
  sat: ['토요일', '토', 'sat', 'saturday'],
  sun: ['일요일', '일', 'sun', 'sunday'],
};

const CHECK_IN_WORDS = ['등원', '입실', '등교', '시작', '오는', '와서', 'start', 'in'];
const CHECK_OUT_WORDS = ['하원', '퇴실', '종료', '가는', '끝', 'end', 'out'];
const NAME_WORDS = ['학생이름', '학생 이름', '이름', '성명', '학생명', 'name'];
const ABSENT_WORDS = ['안옴', '안 옴', '미등원', '휴원', '결석', '쉬는날', '쉬는 날', '없음'];

function stripSpace(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 다양한 형태의 시간 표기를 'HH:MM'으로 정규화합니다.
 * 지원: '09:00' '9:00' '9시' '9시30분' '오전 9시' '오후 6시' '18:30' '1830'
 *      '9' (시로 간주) / 엑셀 Date 객체 / 엑셀 시간 소수(0~1)
 * 인식 불가하거나 '안옴' 류면 '' 을 돌려줍니다.
 */
export function parseTimeValue(value) {
  if (value === null || value === undefined || value === '') return '';

  // 엑셀 셀이 Date로 파싱된 경우
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = String(value.getHours()).padStart(2, '0');
    const mm = String(value.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // 엑셀 시간 소수 (0.5 = 12:00)
  if (typeof value === 'number' && value > 0 && value < 1) {
    const total = Math.round(value * 24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  const raw = String(value).trim();
  if (!raw) return '';
  const compact = stripSpace(raw);
  if (ABSENT_WORDS.some((word) => compact.includes(stripSpace(word)))) return '';

  const isPm = /오후|pm/i.test(compact);
  const isAm = /오전|am/i.test(compact);

  const applyMeridiem = (hour) => {
    let h = hour;
    if (isPm && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    return h;
  };

  const clamp = (h, m) => {
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    if (h < 0 || h > 24 || m < 0 || m > 59) return '';
    // 24:00은 자정으로 허용(자율학습 종료 등)
    const hh = h === 24 ? 24 : h;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 09:00 / 9:00 / 9.30
  let match = compact.match(/(\d{1,2})[:.](\d{2})/);
  if (match) return clamp(applyMeridiem(Number(match[1])), Number(match[2]));

  // 9시30분 / 9시 30
  match = compact.match(/(\d{1,2})시(?:(\d{1,2})분?)?/);
  if (match) return clamp(applyMeridiem(Number(match[1])), Number(match[2] || 0));

  // 1830 (4자리)
  match = compact.match(/^(\d{2})(\d{2})$/);
  if (match) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h <= 24 && m <= 59) return clamp(h, m);
  }

  // 숫자만 (시로 간주)
  match = compact.match(/^(\d{1,2})$/);
  if (match) return clamp(applyMeridiem(Number(match[1])), 0);

  return '';
}

// 셀 값이 "이 요일은 안 옴"을 뜻하는지
export function isAbsentValue(value) {
  const compact = stripSpace(value);
  if (!compact) return false;
  return ABSENT_WORDS.some((word) => compact.includes(stripSpace(word)));
}

function scoreHeaderForDay(header, dayKey) {
  let compact = stripSpace(header);
  if (!compact) return 0;

  // '월요일'의 '일'이 일요일로 잘못 잡히지 않도록,
  // 다른 요일의 두 글자 이상 표기를 먼저 지운 뒤에 판정합니다.
  for (const key of DAY_KEYS) {
    if (key === dayKey) continue;
    for (const alias of DAY_ALIASES[key]) {
      if (alias.length > 1) compact = compact.split(stripSpace(alias)).join(' ');
    }
  }

  const aliases = DAY_ALIASES[dayKey] || [];
  // '월요일'처럼 명확한 표기가 있으면 확신도 높음
  if (aliases.some((alias) => alias.length > 1 && compact.includes(stripSpace(alias)))) return 3;
  // '월'처럼 한 글자만 있으면 약한 확신 (사용자가 화면에서 확인)
  if (aliases.some((alias) => alias.length === 1 && compact.includes(stripSpace(alias)))) return 2;
  return 0;
}

/**
 * 헤더 목록을 보고 매핑 초안을 추측합니다. 사용자는 화면에서 이를 수정합니다.
 */
export function guessColumnMapping(headers = []) {
  const list = (headers || []).map((item, index) => ({ index, header: String(item ?? '').trim() }));

  const nameColumn = list.find((item) => {
    const compact = stripSpace(item.header);
    return NAME_WORDS.some((word) => compact.includes(stripSpace(word)));
  });

  const days = {};
  for (const dayKey of DAY_KEYS) {
    let checkIn = null;
    let checkOut = null;
    let bestIn = 0;
    let bestOut = 0;
    for (const item of list) {
      const dayScore = scoreHeaderForDay(item.header, dayKey);
      if (!dayScore) continue;
      const compact = stripSpace(item.header);
      const inHit = CHECK_IN_WORDS.some((word) => compact.includes(stripSpace(word)));
      const outHit = CHECK_OUT_WORDS.some((word) => compact.includes(stripSpace(word)));
      // '하원'에는 '원'이 겹치므로 등원/하원을 함께 검사해 더 구체적인 쪽을 택합니다.
      if (outHit && dayScore > bestOut) { checkOut = item.index; bestOut = dayScore; }
      else if (inHit && dayScore > bestIn) { checkIn = item.index; bestIn = dayScore; }
    }
    days[dayKey] = { checkIn, checkOut, enabled: checkIn !== null || checkOut !== null };
  }

  return {
    nameColumn: nameColumn ? nameColumn.index : null,
    days,
  };
}

function pick(row, index) {
  if (index === null || index === undefined || index < 0) return '';
  return row?.[index];
}

/**
 * 매핑을 적용해 학생별 "요일 패턴"을 만듭니다.
 * @returns {Array} [{ rowIndex, name, days: { mon: {checkIn,checkOut,absent}, ... }, issues: [] }]
 */
export function buildWeeklyPatterns(rows = [], mapping = {}) {
  const results = [];
  for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex += 1) {
    const row = rows[rowIndex];
    const name = String(pick(row, mapping.nameColumn) ?? '').trim();
    if (!name) continue; // 이름이 없는 행은 응답이 아닌 것으로 봅니다.

    const days = {};
    const issues = [];
    let filledDays = 0;

    for (const dayKey of DAY_KEYS) {
      const config = mapping.days?.[dayKey] || {};
      if (!config.enabled) { days[dayKey] = null; continue; }

      const rawIn = pick(row, config.checkIn);
      const rawOut = pick(row, config.checkOut);
      const absent = isAbsentValue(rawIn) || (!String(rawIn ?? '').trim() && !String(rawOut ?? '').trim());
      if (absent) { days[dayKey] = null; continue; }

      const checkIn = parseTimeValue(rawIn);
      const checkOut = parseTimeValue(rawOut);

      if (!checkIn && String(rawIn ?? '').trim()) {
        issues.push(`${DAY_LABELS[dayKey]} 등원 "${String(rawIn).trim()}" 을(를) 시간으로 읽지 못했습니다.`);
      }
      if (!checkOut && String(rawOut ?? '').trim()) {
        issues.push(`${DAY_LABELS[dayKey]} 하원 "${String(rawOut).trim()}" 을(를) 시간으로 읽지 못했습니다.`);
      }
      if (!checkIn && !checkOut) { days[dayKey] = null; continue; }
      if (checkIn && checkOut && checkOut <= checkIn) {
        issues.push(`${DAY_LABELS[dayKey]} 하원(${checkOut})이 등원(${checkIn})보다 빠르거나 같습니다.`);
      }

      days[dayKey] = { checkIn: checkIn || '', checkOut: checkOut || '', };
      filledDays += 1;
    }

    if (!filledDays) issues.push('등하원 시간이 하나도 인식되지 않았습니다.');

    results.push({ rowIndex, name, days, issues, filledDays });
  }
  return results;
}

// 이름으로 학생을 찾습니다. 공백/대소문자를 무시하고, 동명이인은 별도 표시합니다.
export function matchPatternsToStudents(patterns = [], students = []) {
  const byName = {};
  for (const student of students || []) {
    const key = stripSpace(student?.name);
    if (!key) continue;
    if (!byName[key]) byName[key] = [];
    byName[key].push(student);
  }

  return (patterns || []).map((pattern) => {
    const key = stripSpace(pattern.name);
    const candidates = byName[key] || [];
    const active = candidates.filter((item) => item?.status !== 'inactive');
    const pool = active.length ? active : candidates;
    return {
      ...pattern,
      student: pool.length === 1 ? pool[0] : null,
      candidates: pool,
      matchStatus: pool.length === 1 ? 'matched' : pool.length === 0 ? 'not_found' : 'ambiguous',
    };
  });
}

function addDays(dateString, amount) {
  const base = new Date(`${dateString}T12:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + amount);
  return base.toISOString().slice(0, 10);
}

function dayKeyForDate(dateString) {
  const day = new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
  return DAY_INDEX_TO_KEY[day];
}

/**
 * 요일 패턴을 기간 내 실제 날짜로 펼칩니다.
 * 해당 요일에 등원 정보가 없으면 그 날짜는 아예 만들지 않습니다. (시간표 없음 = 판정 제외)
 */
export function expandPatternToDates(pattern, startDate, endDate, maxDays = 200) {
  const rows = [];
  if (!startDate || !endDate || startDate > endDate) return rows;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < maxDays) {
    const dayKey = dayKeyForDate(cursor);
    const config = pattern?.days?.[dayKey];
    if (config && (config.checkIn || config.checkOut)) {
      rows.push({
        date: cursor,
        dayKey,
        checkIn: config.checkIn || '',
        checkOut: config.checkOut || '',
      });
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return rows;
}

// 미리보기용 요약 문자열: "월 09:00~22:00 · 화 13:00~22:00 · 토 휴원"
export function formatWeeklySummary(pattern) {
  const parts = [];
  for (const dayKey of DAY_KEYS) {
    const config = pattern?.days?.[dayKey];
    if (!config) continue;
    parts.push(`${DAY_LABELS[dayKey]} ${config.checkIn || '-'}~${config.checkOut || '-'}`);
  }
  return parts.length ? parts.join(' · ') : '등원일 없음';
}
