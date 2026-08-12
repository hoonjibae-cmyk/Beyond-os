// Beyond OS v41-152
// 설문의 "특별 일정 상세" 자유 서술에서 날짜 지정 예외를 읽어냅니다.
//
// 실제 응답 예시
//   "7/21 방학식 결석"                       → 7/21 결석
//   "7/27~7/28 여름휴가 결석"                 → 7/27, 7/28 결석
//   "교회수련회 (8/6,7,8), 치과(8/1토, 12:30)" → 8/6·7·8 결석 + 8/1 외출
//   "8/11(화) 9:00~12:00 병원 예약"            → 8/11 외출 09:00~12:00
//   "7/22부터 등원 예정"                       → 7/22 이전은 등원 안 함
//   "가족여행 계획있으나 일정은 미정입니다."      → 확인 필요
//
// 요일 패턴과 달리 "특정 날짜"에만 적용되므로 별도로 해석합니다.
// 애매하면 임의로 넣지 않고 needsReview로 표시합니다.

const UNDECIDED = /(미정|안\s*정|정해지지|차후|추후|달라집니다|모름|계획\s*중|확인\s*중|알려\s*드리)/;
const ABSENT_WORDS = /(결석|여행|휴가|수련회|캠프|불참|안\s*가|못\s*가|못\s*감|행사|모임)/;
const AWAY_WORDS = /(병원|치과|피부과|검진|예약|진료|외출|복귀)/;
const START_FROM = /(부터)\s*(등원|출석|시작)/;

function normalize(value) {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * 월/일에 연도를 붙입니다.
 * 기간(periodStart~periodEnd) 안에 들어오는 연도를 우선 고르고,
 * 없으면 기간 시작 연도를 씁니다. (12월→1월처럼 해가 바뀌는 경우 대비)
 */
function resolveYear(month, day, periodStart, periodEnd) {
  const startYear = Number(String(periodStart || '').slice(0, 4)) || new Date().getFullYear();
  const candidates = [startYear, startYear + 1, startYear - 1];
  for (const year of candidates) {
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    if (periodStart && periodEnd && iso >= periodStart && iso <= periodEnd) return iso;
  }
  return `${startYear}-${pad2(month)}-${pad2(day)}`;
}

function isRealDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function addDaysIso(iso, amount) {
  const base = new Date(`${iso}T12:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + amount);
  return base.toISOString().slice(0, 10);
}

/**
 * 한 조각에서 날짜들을 뽑습니다.
 * 지원: 7/21 · 7월 25일 · 8/6,7,8 · 7/30-31 · 7/27~7/28 · 7/30(목)~8/1(토)
 */
export function extractDates(text, periodStart, periodEnd) {
  const raw = normalize(text);
  const dates = [];
  const seen = new Set();
  const push = (iso) => {
    if (isRealDate(iso) && !seen.has(iso)) { seen.add(iso); dates.push(iso); }
  };

  // 월/일 (요일) 형태를 모두 찾습니다.
  const re = /(\d{1,2})\s*(?:\/|월)\s*(\d{1,2})\s*일?\s*(?:\([^)]*\)|[월화수목금토일]요일|[월화수목금토일](?![요가-힣]))?/g;
  let match;
  const anchors = [];
  while ((match = re.exec(raw)) !== null) {
    anchors.push({
      month: Number(match[1]),
      day: Number(match[2]),
      index: match.index,
      end: re.lastIndex,
    });
  }
  if (!anchors.length) return [];

  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const startIso = resolveYear(anchor.month, anchor.day, periodStart, periodEnd);
    push(startIso);

    const after = raw.slice(anchor.end);

    // 범위: "-31" "~7/28" "~8/1(토)"
    const rangeMatch = after.match(/^\s*(?:~|-|부터)\s*(?:(\d{1,2})\s*(?:\/|월)\s*)?(\d{1,2})\s*일?/);
    if (rangeMatch) {
      const endMonth = rangeMatch[1] ? Number(rangeMatch[1]) : anchor.month;
      const endDay = Number(rangeMatch[2]);
      const endIso = resolveYear(endMonth, endDay, periodStart, periodEnd);
      if (isRealDate(endIso) && endIso >= startIso) {
        let cursor = startIso;
        let guard = 0;
        while (cursor <= endIso && guard < 60) { push(cursor); cursor = addDaysIso(cursor, 1); guard += 1; }
      }
      continue;
    }

    // 같은 달 여러 날: "8/6,7,8" / "7/22,23,24,27,28"
    // 단, "8/1토, 12:30" 처럼 쉼표 뒤가 시각이면 날짜로 읽지 않습니다.
    let rest = after;
    const listRe = /^\s*,\s*(\d{1,2})\s*일?(?!\s*[:시분])/;
    let listMatch = rest.match(listRe);
    while (listMatch) {
      push(resolveYear(anchor.month, Number(listMatch[1]), periodStart, periodEnd));
      rest = rest.slice(listMatch[0].length);
      listMatch = rest.match(listRe);
    }
  }

  return dates.sort();
}

// 조각에서 시간 구간을 뽑습니다. (09:00~12:00 / 10:00~14:30 / 12:30 / 4시)
function extractTimeRange(text) {
  const raw = normalize(text);
  const rangeMatch = raw.match(/(\d{1,2})\s*[:시]\s*(\d{2})?\s*분?\s*(?:~|-|부터)\s*(\d{1,2})\s*[:시]\s*(\d{2})?/);
  const toPm = (hour) => (hour >= 1 && hour <= 8 ? hour + 12 : hour);
  if (rangeMatch) {
    const sh = toPm(Number(rangeMatch[1]));
    const sm = Number(rangeMatch[2] || 0);
    const eh = toPm(Number(rangeMatch[3]));
    const em = Number(rangeMatch[4] || 0);
    return { start: `${pad2(sh)}:${pad2(sm)}`, end: `${pad2(eh)}:${pad2(em)}` };
  }
  const single = raw.match(/(\d{1,2})\s*[:시]\s*(\d{2})?\s*분?/);
  if (single) {
    const h = toPm(Number(single[1]));
    const m = Number(single[2] || 0);
    return { start: `${pad2(h)}:${pad2(m)}`, end: '' };
  }
  return null;
}

// "-> 3시 복귀" 처럼 복귀 시각이 따로 적힌 경우를 잡습니다.
function extractReturnTime(text) {
  const match = normalize(text).match(/(?:->|→|,|\s)\s*(\d{1,2})\s*[:시]\s*(\d{2})?\s*분?\s*복귀/);
  if (!match) return '';
  const hour = Number(match[1]);
  const h = hour >= 1 && hour <= 8 ? hour + 12 : hour;
  return `${pad2(h)}:${pad2(Number(match[2] || 0))}`;
}

// 여러 일정이 한 칸에 적힌 경우를 조각으로 나눕니다.
function splitItems(text) {
  const raw = normalize(text);
  // 1) 줄바꿈과 (1) (2) 번호 표기
  const lines = raw.split(/\n+|\(\s*\d+\s*\)/).map((item) => item.trim()).filter(Boolean);

  const parts = [];
  for (const line of lines) {
    // 2) ')' 뒤에 쉼표로 항목이 이어지는 경우
    //    예: "교회수련회 (8/6,7,8), 치과(8/1토, 12:30)"
    const byParen = line.includes(')')
      ? line.split(/\)\s*,\s*/).map((item, index, arr) => (index < arr.length - 1 ? `${item})` : item))
      : [line];
    for (const piece of byParen) {
      // 3) 마침표 뒤에 새 문장이 이어지는 경우
      //    예: "7/27 4시 병원예약. 날짜미정 가족여행 계획중"
      for (const sentence of piece.split(/\.\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed) parts.push(trimmed);
      }
    }
  }
  return parts.length ? parts : [raw];
}

/**
 * 특별 일정 상세 한 칸을 해석합니다.
 * @returns {{items: Array, needsReview: boolean, raw: string}}
 *   item: { type:'absent'|'away'|'start_from'|'unknown', dates:[], start, end, reason, raw, needsReview }
 */
export function parseSpecialSchedule(rawValue, { periodStart = '', periodEnd = '' } = {}) {
  const raw = normalize(rawValue);
  if (!raw) return { items: [], needsReview: false, raw: '' };

  const items = [];
  for (const chunk of splitItems(raw)) {
    const dates = extractDates(chunk, periodStart, periodEnd);
    const undecided = UNDECIDED.test(chunk);

    // 날짜를 못 찾았거나 미정 표현이면 사람이 확인해야 합니다.
    if (!dates.length || (undecided && !dates.length)) {
      items.push({ type: 'unknown', dates: [], start: '', end: '', reason: chunk.slice(0, 120), raw: chunk, needsReview: true });
      continue;
    }

    // "7/22부터 등원 예정"
    if (START_FROM.test(chunk)) {
      items.push({ type: 'start_from', dates: [dates[0]], start: '', end: '', reason: chunk.slice(0, 120), raw: chunk, needsReview: false });
      continue;
    }

    const time = extractTimeRange(chunk);
    const returnTime = extractReturnTime(chunk);
    const looksAway = Boolean(time) || AWAY_WORDS.test(chunk);
    const looksAbsent = ABSENT_WORDS.test(chunk);

    // 시간이 적혀 있으면 외출, 아니면 결석으로 봅니다.
    // 둘 다 걸리면(예: "가족모임 -> 3시 복귀") 시간이 있는 쪽을 우선합니다.
    if (looksAway && time) {
      items.push({
        type: 'away',
        dates,
        start: time.start,
        end: returnTime || time.end || '',
        reason: chunk.slice(0, 120),
        raw: chunk,
        // 복귀 시각이 없으면 언제 돌아오는지 알 수 없어 확인이 필요합니다.
        needsReview: !(returnTime || time.end) || undecided,
      });
      continue;
    }

    if (looksAbsent || !time) {
      items.push({
        type: 'absent',
        dates,
        start: '',
        end: '',
        reason: chunk.slice(0, 120),
        raw: chunk,
        needsReview: undecided,
      });
      continue;
    }

    items.push({ type: 'unknown', dates, start: '', end: '', reason: chunk.slice(0, 120), raw: chunk, needsReview: true });
  }

  return {
    items,
    needsReview: items.some((item) => item.needsReview),
    raw,
  };
}

export const SPECIAL_TYPE_LABELS = { absent: '결석', away: '외출', start_from: '등원 시작', unknown: '확인 필요' };

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

// '2025-08-06' → '8/6(수)'
export function formatSpecialDate(iso) {
  if (!isRealDate(iso)) return String(iso || '');
  const [, month, day] = iso.split('-');
  const weekday = WEEKDAY_LABELS[new Date(`${iso}T12:00:00+09:00`).getUTCDay()];
  return `${Number(month)}/${Number(day)}(${weekday})`;
}

/**
 * 해석된(또는 학부모가 손본) 특별 일정 항목을 실제 시간표에 적용할 형태로 바꿉니다.
 * 기간 밖 날짜는 여기서 잘라냅니다. (예: 8/15-17 가족여행 중 기수 종료 후인 8/17)
 *
 * @returns {{startFrom:string, absent:Array<{date,reason}>, away:Array<{date,start,end,reason}>, notes:string[], dropped:string[]}}
 */
export function buildSpecialOverrides(items = [], { periodStart = '', periodEnd = '' } = {}) {
  const absent = [];
  const away = [];
  const notes = [];
  const dropped = [];
  const seenAbsent = new Set();
  let startFrom = '';

  const inPeriod = (iso) => {
    if (!isRealDate(iso)) return false;
    if (periodStart && iso < periodStart) return false;
    if (periodEnd && iso > periodEnd) return false;
    return true;
  };

  for (const item of items || []) {
    if (!item) continue;
    if (item.include === false) continue; // 학부모가 "해당 없음"으로 끈 항목

    if (item.type === 'start_from') {
      const first = (item.dates || [])[0];
      // 등원 시작일은 기간 안으로 들어와야 의미가 있습니다.
      if (isRealDate(first) && (!startFrom || first > startFrom)) startFrom = first;
      continue;
    }

    const dates = [];
    for (const date of item.dates || []) {
      if (inPeriod(date)) dates.push(date);
      else if (isRealDate(date)) dropped.push(date);
    }

    if (item.type === 'absent') {
      for (const date of dates) {
        if (seenAbsent.has(date)) continue;
        seenAbsent.add(date);
        absent.push({ date, reason: String(item.reason || '').slice(0, 100) });
      }
      continue;
    }

    if (item.type === 'away') {
      for (const date of dates) {
        away.push({
          date,
          start: item.start || '',
          end: item.end || '',
          reason: String(item.reason || '').slice(0, 100),
        });
      }
      continue;
    }

    // unknown: 자동 적용하지 않고 메모로만 남깁니다.
    if (item.raw) notes.push(String(item.raw).slice(0, 200));
  }

  return { startFrom, absent, away, notes, dropped };
}

// 화면 표기용 한 줄 요약
export function formatSpecialItem(item) {
  if (!item) return '';
  const dateLabel = (item.dates || []).length
    ? (item.dates.length > 3
      ? `${formatSpecialDate(item.dates[0])} 외 ${item.dates.length - 1}일`
      : item.dates.map(formatSpecialDate).join(', '))
    : '날짜 미확인';
  const typeLabel = SPECIAL_TYPE_LABELS[item.type] || item.type;
  const timeLabel = item.type === 'away' ? ` ${item.start || '?'}~${item.end || '?'}` : '';
  return `${dateLabel} · ${typeLabel}${timeLabel}`;
}
