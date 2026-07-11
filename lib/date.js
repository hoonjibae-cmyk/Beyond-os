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
