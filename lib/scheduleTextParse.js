// Beyond OS v41-150
// 등하원 설문의 "요일 칸 자유 서술"을 시간표 구조로 해석합니다.
//
// 실제 응답 예시
//   "기본 일정 준수 (09:00 - 22:00)"            → 기본 시간표 그대로
//   "6:50 하원 / 수학학원 19:00-22:00"           → 18:50 하원
//   "4:50 하원 8:30 복귀 / 영어 17:00-20:00"     → 16:50~20:30 외출
//   "12:00~20:20 외출 / 수학,영어학원"            → 12:00~20:20 외출
//   "못감.수학학원 하루종일" / "이용불가"          → 결석
//   "11시 등원/논술학원"                          → 11:00 등원
//   "9~12 공부 / 발레학원..."                     → 09:00 등원, 12:00 하원
//
// 12시간 표기(6:50, 5시)가 대부분이라 운영시간(09:00~24:00) 기준으로 오전/오후를 추정합니다.
// 애매한 응답은 억지로 해석하지 않고 needsReview로 표시해 사람이 확인하게 합니다.

const ABSENT_PATTERNS = /(못\s*감|못\s*가|이용\s*불가|등원\s*불가|결석|안\s*감|안\s*가|불참)/;
const BASE_PATTERNS = /(기본\s*일정\s*준수|기본일정|기본\s*시간표)/;
// 사람이 판단해야 하는 응답 (미확정/보류)
const PENDING_PATTERNS = /(미적용|확인\s*중|기다리는\s*중|회신|모름|변동|있을\s*수|있을수|정확한\s*시간)/;

function normalizeText(value) {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function pad(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 12시간 표기를 운영시간(09:00~24:00) 기준으로 24시간제로 바꿉니다.
 * 1~8시는 오후로 봅니다. (운영 시작이 09:00이라 오전 1~8시는 있을 수 없음)
 * 9~12시는 문맥이 없으면 오전으로 둡니다.
 */
export function toOperatingHour(hour, { forcePm = false, forceAm = false } = {}) {
  let h = Number(hour);
  if (!Number.isFinite(h)) return null;
  if (forceAm) return h === 12 ? 0 : h;
  if (forcePm) return h < 12 ? h + 12 : h;
  if (h >= 1 && h <= 8) return h + 12;
  return h;
}

// 문자열 한 곳에서 시각 하나를 읽습니다. 반환: { hour, minute, raw, index, explicit24 }
function readTimes(text) {
  const found = [];
  const re = /(오전|오후|am|pm)?\s*(\d{1,2})\s*(?::|시|\.)\s*(\d{1,2})?\s*분?|(오전|오후|am|pm)?\s*(\d{1,2})\s*시/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const meridiem = (match[1] || match[4] || '').toLowerCase();
    const hourRaw = match[2] ?? match[5];
    const minuteRaw = match[3];
    if (hourRaw === undefined) continue;
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw || 0);
    if (!Number.isFinite(hour) || hour > 24 || minute > 59) continue;
    found.push({
      hour,
      minute,
      index: match.index,
      length: match[0].length,
      raw: match[0].trim(),
      forcePm: /오후|pm/.test(meridiem),
      forceAm: /오전|am/.test(meridiem),
      // '18:30'처럼 13 이상이면 이미 24시간제
      explicit24: hour >= 13,
    });
  }
  return found;
}

function resolveTime(item, { forcePm = false } = {}) {
  if (!item) return '';
  if (item.explicit24 || item.forceAm || item.forcePm) {
    const h = toOperatingHour(item.hour, { forceAm: item.forceAm, forcePm: item.forcePm });
    return pad(h === 24 ? 24 : h, item.minute);
  }
  const h = toOperatingHour(item.hour, { forcePm });
  return pad(h, item.minute);
}

// "/" 뒤쪽이나 괄호 안을 사유로 봅니다.
function extractReason(text) {
  const slash = text.split('/');
  if (slash.length > 1) {
    const tail = slash.slice(1).join('/').trim();
    if (tail) return tail.slice(0, 100);
  }
  const paren = text.match(/[(（]([^)）]{2,})[)）]/);
  if (paren) return paren[1].trim().slice(0, 100);
  return '';
}

/**
 * 요일 칸 한 개를 해석합니다.
 * @param {string} rawValue 설문 응답 원문
 * @param {Object} base     { checkIn, checkOut } 해당 요일 기본 시간표
 * @returns {{mode, checkIn, checkOut, breaks, reason, needsReview, note, raw}}
 */
export function parseDayScheduleText(rawValue, base = { checkIn: '09:00', checkOut: '22:00' }) {
  const raw = normalizeText(rawValue);
  const result = {
    mode: 'none',
    checkIn: '',
    checkOut: '',
    breaks: [],
    reason: '',
    needsReview: false,
    note: '',
    raw,
  };
  if (!raw) return result;

  result.reason = extractReason(raw);

  // 1) 결석
  if (ABSENT_PATTERNS.test(raw)) {
    result.mode = 'absent';
    result.note = '결석(미등원)으로 해석했습니다.';
    return result;
  }

  // 2) 사람이 확인해야 하는 보류성 응답
  //    단, '9~12 공부'처럼 학습 구간이 분명하면 보류로 넘기지 않고 아래에서 해석합니다.
  const hasStudyRange = /(\d{1,2})\s*(?:시)?\s*(?:~|-)\s*(\d{1,2})\s*(?:시)?\s*(?:공부|학습|이용)/.test(raw);
  if (PENDING_PATTERNS.test(raw) && !hasStudyRange && !/하원|복귀|외출|등원/.test(raw)) {
    result.mode = 'unknown';
    result.needsReview = true;
    result.note = '확정되지 않은 응답입니다. 직접 확인해 주세요.';
    return result;
  }

  // 3) 기본 일정 준수 — 괄호 안에 시간이 있으면 그 값을 씁니다.
  if (BASE_PATTERNS.test(raw)) {
    const times = readTimes(raw);
    result.mode = 'base';
    if (times.length >= 2) {
      result.checkIn = resolveTime(times[0]);
      result.checkOut = resolveTime(times[1], { forcePm: true });
    } else {
      result.checkIn = base.checkIn;
      result.checkOut = base.checkOut;
    }
    // '토모 외 기본 일정 준수'처럼 단서가 붙으면 확인이 필요합니다.
    if (/외\s*기본|제외/.test(raw)) {
      result.needsReview = true;
      result.note = '기본 일정에 예외 조건이 붙어 있습니다. 확인해 주세요.';
    }
    return result;
  }

  // 여러 줄이면 줄마다 외출로 해석합니다. (예: 오전 학원 / 저녁 학원)
  const lines = raw.split(/\n+/).map(normalizeText).filter(Boolean);
  if (lines.length > 1) {
    const merged = { ...result, mode: 'custom', checkIn: base.checkIn, checkOut: base.checkOut, breaks: [] };
    for (const line of lines) {
      const sub = parseDayScheduleText(line, base);
      if (sub.breaks.length) merged.breaks.push(...sub.breaks);
      else if (sub.checkOut && !sub.breaks.length && sub.mode === 'custom' && !sub.checkIn) merged.checkOut = sub.checkOut;
      if (sub.needsReview) merged.needsReview = true;
    }
    if (!merged.breaks.length) { merged.needsReview = true; merged.note = '여러 줄 응답을 해석하지 못했습니다.'; }
    return merged;
  }

  const times = readTimes(raw);

  // 4) 하원 + 복귀 → 외출 구간
  const hasReturn = /복귀/.test(raw);
  const hasLeave = /하원/.test(raw);
  if (hasLeave && hasReturn && times.length >= 2) {
    const start = resolveTime(times[0]);
    const end = resolveTime(times[1], { forcePm: true });
    result.mode = 'custom';
    result.checkIn = base.checkIn;
    result.checkOut = base.checkOut;
    result.breaks = [{ start, end, reason: result.reason || '학원' }];
    return result;
  }

  // 5) 외출 A~B
  const awayRange = raw.match(/(\d{1,2}\s*[:.]?\s*\d{0,2})\s*(?:~|-|부터)\s*(\d{1,2}\s*[:.]?\s*\d{0,2})\s*(?:까지)?\s*(?:외출|나감)/);
  if (/외출/.test(raw) && times.length >= 2) {
    const start = resolveTime(times[0]);
    const end = resolveTime(times[1], { forcePm: true });
    result.mode = 'custom';
    result.checkIn = base.checkIn;
    result.checkOut = base.checkOut;
    result.breaks = [{ start, end, reason: result.reason || '학원' }];
    if (!awayRange && times.length > 2) {
      result.needsReview = true;
      result.note = '시각이 여러 개 적혀 있어 앞의 두 개를 외출 구간으로 잡았습니다. 확인해 주세요.';
    }
    return result;
  }

  // 6) 하원만 → 조기 하원
  if (hasLeave && times.length >= 1) {
    result.mode = 'custom';
    result.checkIn = base.checkIn;
    result.checkOut = resolveTime(times[0], { forcePm: true });
    return result;
  }

  // 7) 등원 시각 지정
  if (/등원/.test(raw) && times.length >= 1) {
    result.mode = 'custom';
    result.checkIn = resolveTime(times[0]);
    result.checkOut = base.checkOut;
    return result;
  }

  // 8) "9~12 공부" 처럼 학습 구간을 직접 적은 경우
  const studyRange = raw.match(/(\d{1,2})\s*(?:시)?\s*(?:~|-)\s*(\d{1,2})\s*(?:시)?\s*(?:공부|학습|이용)/);
  if (studyRange) {
    result.mode = 'custom';
    // 9~12시는 기본 규칙(1~8시만 오후)이 그대로 맞습니다. 12는 정오이므로 변환하지 않습니다.
    result.checkIn = pad(toOperatingHour(Number(studyRange[1])), 0);
    result.checkOut = pad(toOperatingHour(Number(studyRange[2])), 0);
    return result;
  }

  // 9) 시각만 덩그러니 적힌 경우 (예: "4시 30분 ( 타학원 스케쥴)") → 하원으로 추정하되 확인 필요
  if (times.length >= 1) {
    result.mode = 'custom';
    result.checkIn = base.checkIn;
    result.checkOut = resolveTime(times[0], { forcePm: true });
    result.needsReview = true;
    result.note = '“하원/외출” 표기가 없어 하원 시각으로 추정했습니다. 확인해 주세요.';
    return result;
  }

  result.mode = 'unknown';
  result.needsReview = true;
  result.note = '시간을 찾지 못했습니다. 직접 입력해 주세요.';
  return result;
}
