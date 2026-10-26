export function getKstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function diffMinutes(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}
export function formatMinutes(minutes) {
  const m = Math.max(0, Number(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

// v41-278: 기준 날짜(KST 자정)부터 지난 분. 자정을 넘긴 하원(다음날 00:04)은 1444 가 됩니다.
//
// 지금까지 지각·조퇴 판정은 '그날의 분(0~1439)'만 봐서, 00:04 하원이 예정 하원 22:00 보다
// 1,316분 이른 것으로 계산돼 리포트 확인사항에 '조퇴'가 찍혔습니다.
// 기준 날짜를 모르면 예전처럼 그날의 분을 돌려줍니다.
export function getKstMinutesSinceDate(iso, dateString) {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  const date = String(dateString || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const base = new Date(`${date}T00:00:00+09:00`).getTime();
    if (!Number.isNaN(base)) return Math.round((time - base) / 60000);
  }
  const kst = new Date(time + 9 * 3600 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}
