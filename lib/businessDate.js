// Beyond OS v41-246 — 운영일(業務日) 기준 날짜
//
// 왜 필요한가
//   운영 마감을 새벽 1시로 늘렸는데, 화면과 출결 처리는 여전히 자정을 하루의
//   경계로 봤습니다. 그래서 00:00~01:00 사이에는 학생들이 실제로 앉아 있는데도
//   좌석판이 새 날짜로 넘어가 전원 [미입실]로 보이고, 그 시간에는 입실·외출·퇴실
//   조작도 엉뚱한 날짜에 기록됐습니다.
//
//   운영일은 "마감 시각까지"입니다. 마감이 새벽 1시면 00:30 은 아직 어제입니다.
//
// 마감 시각(자정 이후 분)은 설정 · 키오스크 브리지 설정에 있습니다.
//   0  → 자정 마감. 이때는 아래 함수들이 예전 getKstDateString() 과 완전히 같습니다.
//   60 → 새벽 1시 마감.

/** KST 기준 그날 자정부터의 분 (0~1439) */
export function getKstMinuteOfDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  // KST 는 서머타임이 없어 +9시간 고정으로 계산합니다.
  return Math.floor(time / 60000 + 9 * 60) % 1440;
}

/** KST 달력 날짜 (YYYY-MM-DD) */
export function getKstCalendarDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function shiftDate(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * 지금이 속한 운영일.
 *
 * 마감 시각(자정 + offsetMinutes) 이전이면 아직 어제가 운영일입니다.
 * offsetMinutes 가 0 이면 달력 날짜와 같습니다. (기존 동작)
 */
export function getBusinessDateString(offsetMinutes = 0, now = new Date()) {
  const calendar = getKstCalendarDate(now);
  if (!calendar) return calendar;
  const offset = Math.max(0, Math.round(Number(offsetMinutes || 0)));
  if (!offset) return calendar;
  const minuteOfDay = getKstMinuteOfDay(now);
  if (minuteOfDay === null) return calendar;
  return minuteOfDay < offset ? shiftDate(calendar, -1) : calendar;
}

/** 그 운영일이 끝나는 시각 (다음 날 자정 + offset) */
export function getBusinessDayEndIso(businessDate, offsetMinutes = 0) {
  const next = shiftDate(String(businessDate || '').slice(0, 10), 1);
  const base = new Date(`${next}T00:00:00+09:00`).getTime();
  if (Number.isNaN(base)) return '';
  return new Date(base + Math.max(0, Math.round(Number(offsetMinutes || 0))) * 60000).toISOString();
}

/** 그 운영일이 시작하는 시각 (그날 자정) */
export function getBusinessDayStartIso(businessDate) {
  return new Date(`${String(businessDate || '').slice(0, 10)}T00:00:00+09:00`).toISOString();
}
