// Beyond OS v41-273
// 일정 메모(schedule_note)를 '늦은 등원 사유'와 '이른 하원 사유'로 나누는 공용 로직입니다.
//
// 배경
//   정상 시간보다 늦게 와서 일찍 가는 날, 메모에 '저녁식사, 영어학원'처럼 두 사유를 적어 둡니다.
//   지금까지는 메모 전체가 늦은 등원 구간과 이른 하원 구간 양쪽에 똑같이 붙어
//   "늦은 등원 · 저녁식사, 영어학원 / 이른 하원 · 저녁식사, 영어학원"으로 읽혔습니다.
//
// 규칙
//   - 쉼표(,) 슬래시(/) 세로줄(|) 세미콜론(;) 가운뎃점(·) 으로 나눕니다.
//   - 늦은 등원과 이른 하원이 '둘 다' 있는 날에 두 조각 이상이면
//       앞 조각 → 늦은 등원 사유, 나머지 조각 → 이른 하원 사유.
//   - 그 외(한쪽만 있거나, 조각이 하나)는 메모 전체를 해당 구간에 그대로 붙입니다.
//   - 자동 생성 출처 메모('… 자동 등록', '… 일괄 생성' 등)는 사유가 아니므로 비웁니다.

export const SCHEDULE_NOTE_SPLIT_PATTERN = /\s*(?:,|，|\/|／|\||｜|;|；|·)\s*/;

// v41-194: 시간표가 어디서 만들어졌는지 적어 둔 메모. 부재 사유로 쓰지 않습니다.
export const AUTO_SCHEDULE_NOTE_PATTERN = /(자동\s*등록|일괄\s*생성|기본\s*시간표|학부모\s*확인\s*시간표|설문\s*응답)/;

export function cleanScheduleNote(note) {
  const text = String(note || '').trim();
  if (!text || AUTO_SCHEDULE_NOTE_PATTERN.test(text)) return '';
  return text;
}

export function splitScheduleNote(note) {
  const text = cleanScheduleNote(note);
  if (!text) return [];
  return text.split(SCHEDULE_NOTE_SPLIT_PATTERN).map((part) => part.trim()).filter(Boolean);
}

/**
 * @param {string} note       일정 메모
 * @param {object} context    { lateIn: 늦은 등원 구간이 있는가, earlyOut: 이른 하원 구간이 있는가 }
 * @returns {{ in: string, out: string, split: boolean }}
 */
export function resolveAbsenceReasons(note, { lateIn = false, earlyOut = false } = {}) {
  const whole = cleanScheduleNote(note);
  const parts = splitScheduleNote(note);
  if (lateIn && earlyOut && parts.length >= 2) {
    return { in: parts[0], out: parts.slice(1).join(', '), split: true };
  }
  return { in: lateIn ? whole : '', out: earlyOut ? whole : '', split: false };
}

/**
 * 시간표 이미지 · 학부모 확인 화면용 한 줄 설명을 만듭니다.
 *   늦은 등원(기준 17:30): 저녁식사 · 이른 하원(기준 22:30): 영어학원
 * 기준이 없어 판정을 못 해도 메모는 그대로 보여 줍니다.
 */
export function buildShiftDescription({ lateIn = false, earlyOut = false, note = '', inLabel = '늦은 등원', outLabel = '이른 하원' } = {}) {
  const reasons = resolveAbsenceReasons(note, { lateIn, earlyOut });
  const parts = [];
  if (lateIn) parts.push(reasons.in ? `${inLabel}: ${reasons.in}` : inLabel);
  if (earlyOut) parts.push(reasons.out ? `${outLabel}: ${reasons.out}` : outLabel);
  if (!lateIn && !earlyOut) {
    const whole = cleanScheduleNote(note);
    if (whole) parts.push(whole);
  }
  return parts.join(' · ');
}

// 시간표 수정 팝업의 일정 메모 칸 아래 안내문
export const SCHEDULE_NOTE_HELP = '늦게 등원하고 일찍 하원하는 날은 "저녁식사, 영어학원"처럼 쉼표(,)나 슬래시(/)로 나눠 적어 주세요. 앞은 늦은 등원 사유, 뒤는 이른 하원 사유로 시간표·학부모 안내에 따로 표시됩니다. 하나만 적으면 해당 구간 전체에 같은 사유가 붙습니다.';
