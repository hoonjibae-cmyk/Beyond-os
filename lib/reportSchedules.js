// Beyond OS v41-158
// 리포트 예약 발송 공용 모듈입니다.
//
// 예약은 "무엇을 언제 보낼지"만 담고, 본문은 발송 시점에 다시 읽습니다.
// 예약해 둔 뒤 코멘트를 고치면 고친 내용이 나갑니다.

export const REPORT_SCHEDULE_TYPES = {
  daily: { key: 'daily', label: '데일리 리포트', targetLabel: '세션' },
  weekly: { key: 'weekly', label: '위클리 리포트', targetLabel: '리포트' },
};

export const SCHEDULE_STATUS_LABELS = {
  pending: '예약 대기',
  processing: '발송 중',
  done: '발송 완료',
  failed: '발송 실패',
  canceled: '취소됨',
};

// Cron 주기보다 너무 촘촘한 예약은 의미가 없으므로 최소 여유를 둡니다.
export const MIN_LEAD_MINUTES = 1;
// 예약을 너무 먼 미래로 잡아 잊어버리는 것을 막습니다.
export const MAX_LEAD_DAYS = 60;
export const MAX_TARGETS = 300;

export function normalizeReportScheduleType(value) {
  const raw = String(value || '').trim();
  return REPORT_SCHEDULE_TYPES[raw] ? raw : '';
}

/**
 * 화면에서 받은 날짜/시각(한국시간)을 timestamptz로 바꿉니다.
 * 브라우저 시간대와 무관하게 항상 KST로 해석합니다.
 */
export function kstDateTimeToIso(dateString, timeString) {
  const date = String(dateString || '').trim();
  const time = String(timeString || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  if (!/^\d{2}:\d{2}$/.test(time)) return '';
  const parsed = new Date(`${date}T${time}:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

// timestamptz → { date, time } (한국시간)
export function isoToKstParts(iso) {
  if (!iso) return { date: '', time: '' };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: '', time: '' };
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

// "08/14(목) 19:30" 형태의 표시용 문자열
export function formatScheduleTime(iso) {
  const { date, time } = isoToKstParts(iso);
  if (!date) return '-';
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${date}T12:00:00+09:00`).getUTCDay()];
  return `${date.slice(5).replace('-', '/')}(${weekday}) ${time}`;
}

/**
 * 예약 시각이 쓸 수 있는 값인지 확인합니다.
 * @returns {{ok:boolean, error?:string, iso?:string}}
 */
export function validateScheduledAt(iso, now = new Date()) {
  if (!iso) return { ok: false, error: '예약 날짜와 시각을 모두 입력하세요.' };
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return { ok: false, error: '예약 시각을 해석하지 못했습니다.' };

  const diffMinutes = (target.getTime() - now.getTime()) / 60000;
  if (diffMinutes < MIN_LEAD_MINUTES) {
    return { ok: false, error: '예약 시각은 현재보다 뒤여야 합니다. 지금 보내려면 [즉시 발송]을 사용하세요.' };
  }
  if (diffMinutes > MAX_LEAD_DAYS * 24 * 60) {
    return { ok: false, error: `예약은 최대 ${MAX_LEAD_DAYS}일 뒤까지 가능합니다.` };
  }
  return { ok: true, iso: target.toISOString() };
}

/**
 * 화면에서 보낸 대상 목록을 저장 가능한 형태로 다듬습니다.
 * id가 없는 항목은 버리고, 같은 id는 하나만 남깁니다.
 */
export function normalizeTargets(targets = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(targets) ? targets : []) {
    const id = String(item?.id ?? item ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      studentName: String(item?.studentName || '').slice(0, 40),
    });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

// "2026-08-14 데일리 리포트 24명"
export function buildScheduleLabel(reportType, targets = [], extra = '') {
  const typeLabel = REPORT_SCHEDULE_TYPES[reportType]?.label || reportType;
  const count = targets.length;
  const names = targets.slice(0, 3).map((item) => item.studentName).filter(Boolean);
  const nameHint = names.length
    ? ` (${names.join(', ')}${count > names.length ? ` 외 ${count - names.length}명` : ''})`
    : '';
  return [extra, `${typeLabel} ${count}건${nameHint}`].filter(Boolean).join(' · ').slice(0, 200);
}
