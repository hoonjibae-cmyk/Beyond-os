// Beyond OS v41-255 — 출결 이력 한 줄의 시각을 고칠 때 쓰는 계산/검증 모듈
//
// 왜 필요한가
//   [최근 출결 이력]에 찍힌 "19:30 · 외출 처리" 같은 줄의 시각을 직접 고치는 기능을
//   붙였습니다. 그런데 이벤트 시각만 바꾸면 daily_sessions 의 입실/퇴실/외출누적/
//   순공시간과 어긋납니다. 화면 두 곳의 숫자가 달라 보이고, 리포트도 갈라집니다.
//
//   그래서 이벤트를 하루의 원본으로 보고, 이벤트 목록에서 세션 값을 다시 만듭니다.
//   고친 결과가 이상하면 저장하기 전에 경고를 돌려줍니다.
//
// 여기에는 DB 접근이 없습니다. 순수 계산만 하므로 그대로 테스트할 수 있습니다.

import { getStudyWindowMinutesBetween, calculateScheduledPureStudyMinutes } from './studyTime';

/** 시각을 가진 출결 이벤트 종류. 나머지(manual_edit 등)는 기록용이라 고치지 않습니다. */
export const TIME_EDITABLE_EVENT_TYPES = ['check_in', 'away', 'return', 'check_out'];

export function isTimeEditableEvent(event = {}) {
  return TIME_EDITABLE_EVENT_TYPES.includes(String(event?.event_type || ''));
}

export const EVENT_TYPE_LABELS = {
  check_in: '입실',
  away: '외출',
  return: '복귀',
  check_out: '퇴실',
  absent: '결석',
  needs_attention: '관리필요',
  manual_edit: '수동수정',
};

export function getEventTypeLabel(type) {
  return EVENT_TYPE_LABELS[String(type || '')] || String(type || '기록');
}

function toMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function diffMin(startIso, endIso) {
  const start = toMs(startIso);
  const end = toMs(endIso);
  if (start === null || end === null) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

/** 'HH:MM' → 자정부터의 분. 형식이 틀리면 null. */
export function parseTimeOfDay(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function shiftDate(dateString, amount) {
  const date = new Date(`${String(dateString || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(dateString || '');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * 운영일 + 'HH:MM' → ISO 시각.
 *
 * 마감이 새벽 1시면 하루의 경계는 02:00 입니다(마감 + 1시간). 그래서 00:30 은
 * 그 운영일의 '다음 달력 날짜' 새벽입니다. 이걸 빼먹으면 24시간 어긋납니다.
 * (기존 /api/attendance-adjust 의 toIso 는 항상 session_date 를 붙여서 이 경우가
 *  틀립니다. 이 모듈을 쓰는 경로에서는 바로잡습니다.)
 */
export function resolveEventIso(sessionDate, timeOfDayMinutes, boundaryMinutes = 0) {
  const date = String(sessionDate || '').slice(0, 10);
  if (!date || timeOfDayMinutes === null || timeOfDayMinutes === undefined) return '';
  const boundary = Math.max(0, Math.round(Number(boundaryMinutes || 0)));
  const calendarDate = timeOfDayMinutes < boundary ? shiftDate(date, 1) : date;
  const base = new Date(`${calendarDate}T00:00:00+09:00`).getTime();
  if (Number.isNaN(base)) return '';
  return new Date(base + timeOfDayMinutes * 60000).toISOString();
}

function eventTime(event = {}) {
  return event.event_at || event.created_at || null;
}

function sortEvents(events = []) {
  return (Array.isArray(events) ? [...events] : [])
    .filter((event) => eventTime(event))
    .sort((a, b) => {
      const diff = (toMs(eventTime(a)) || 0) - (toMs(eventTime(b)) || 0);
      if (diff) return diff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

/**
 * 이벤트 목록에서 세션 값을 다시 만듭니다.
 *
 * 규칙은 lib/studyTime.js 의 buildAwayIntervalsFromEvents 와 같습니다.
 *   - 외출 → 복귀 사이는 자리비움
 *   - 퇴실 → 재입실/복귀 사이도 자리비움 (v41-233에서 정한 규칙)
 *   - 닫히지 않은 외출은 away_started_at 으로 남기고 누적에는 넣지 않습니다.
 * away_total_minutes 는 실제 경과 분입니다. 학습 인정 구간으로 자르지 않습니다.
 */
export function deriveSessionFromEvents(events = []) {
  const sorted = sortEvents(events).filter((event) => TIME_EDITABLE_EVENT_TYPES.includes(event.event_type));

  let checkInAt = null;
  let checkOutAt = null;
  let awayTotalMinutes = 0;
  let openAwayAt = null;
  let lastCheckOutAt = null;

  for (const event of sorted) {
    const at = eventTime(event);
    const type = event.event_type;

    if (type === 'check_in') {
      if (!checkInAt) checkInAt = at;
      if (lastCheckOutAt) {
        awayTotalMinutes += diffMin(lastCheckOutAt, at);
        lastCheckOutAt = null;
      }
      checkOutAt = null;
    }

    if (type === 'away') {
      if (!openAwayAt) openAwayAt = at;
      lastCheckOutAt = null;
    }

    if (type === 'return') {
      if (openAwayAt) {
        awayTotalMinutes += diffMin(openAwayAt, at);
        openAwayAt = null;
      } else if (lastCheckOutAt) {
        awayTotalMinutes += diffMin(lastCheckOutAt, at);
        lastCheckOutAt = null;
      }
      checkOutAt = null;
    }

    if (type === 'check_out') {
      if (openAwayAt) {
        awayTotalMinutes += diffMin(openAwayAt, at);
        openAwayAt = null;
      }
      checkOutAt = at;
      lastCheckOutAt = at;
    }
  }

  return {
    checkInAt,
    checkOutAt,
    awayStartedAt: openAwayAt,
    awayTotalMinutes,
    counts: sorted.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {}),
    sorted,
  };
}

function buildProjectedSession(session = {}, derived = {}) {
  const next = { ...session };
  // 그 종류의 이벤트가 하나도 없으면 세션 값을 건드리지 않습니다.
  // (키오스크 기록이 빠져 있는 세션에서 멀쩡한 값을 지우지 않기 위해서입니다)
  if (derived.counts?.check_in) next.check_in_at = derived.checkInAt;
  if (derived.counts?.check_out) next.check_out_at = derived.checkOutAt;
  if (derived.counts?.away || derived.counts?.return || derived.counts?.check_out) {
    next.away_started_at = derived.awayStartedAt;
    next.away_total_minutes = derived.awayTotalMinutes;
  }
  return next;
}

function pureStudyOf(session, events, studyWindows, nowIso) {
  return calculateScheduledPureStudyMinutes(session, { nowIso, events, studyWindows });
}

function formatKstHm(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hour = Math.floor(total / 60);
  const rest = total % 60;
  if (!total) return '0분';
  if (!hour) return `${rest}분`;
  if (!rest) return `${hour}시간`;
  return `${hour}시간 ${rest}분`;
}

/**
 * 시각 수정 결과를 미리 계산하고 검증합니다.
 *
 * @returns {{ ok, blocked, warnings, before, after, projectedSession, projectedEvents }}
 *   blocked  저장하면 안 되는 이유 (형식 오류 등). 있으면 저장하지 않습니다.
 *   warnings 저장은 가능하지만 사람이 확인해야 하는 것들.
 */
export function planAttendanceEventTimeChange({
  event,
  session = {},
  events = [],
  newIso,
  studyWindows,
  nowIso = new Date().toISOString(),
} = {}) {
  const blocked = [];
  const warnings = [];

  if (!event?.id) blocked.push('수정할 출결 이력을 찾을 수 없습니다.');
  if (!isTimeEditableEvent(event)) {
    blocked.push(`${getEventTypeLabel(event?.event_type)} 기록은 시각을 고칠 수 없습니다. 입실·외출·복귀·퇴실만 가능합니다.`);
  }
  if (!newIso) blocked.push('시각을 HH:MM 형식으로 입력하세요.');
  if (blocked.length) return { ok: false, blocked, warnings, before: null, after: null };

  const label = getEventTypeLabel(event.event_type);
  const oldIso = eventTime(event);

  const currentEvents = Array.isArray(events) ? events : [];
  const projectedEvents = currentEvents.map((row) => (
    String(row.id) === String(event.id) ? { ...row, event_at: newIso } : row
  ));

  const beforeDerived = deriveSessionFromEvents(currentEvents);
  const afterDerived = deriveSessionFromEvents(projectedEvents);
  const beforeSession = buildProjectedSession(session, beforeDerived);
  const afterSession = buildProjectedSession(session, afterDerived);

  const before = {
    time: formatKstHm(oldIso),
    iso: oldIso,
    checkInAt: beforeSession.check_in_at || null,
    checkOutAt: beforeSession.check_out_at || null,
    awayMinutes: Number(beforeSession.away_total_minutes || 0),
    pureStudyMinutes: pureStudyOf(beforeSession, currentEvents, studyWindows, nowIso),
  };
  const after = {
    time: formatKstHm(newIso),
    iso: newIso,
    checkInAt: afterSession.check_in_at || null,
    checkOutAt: afterSession.check_out_at || null,
    awayMinutes: Number(afterSession.away_total_minutes || 0),
    pureStudyMinutes: pureStudyOf(afterSession, projectedEvents, studyWindows, nowIso),
  };

  // ── 경고 ───────────────────────────────────────────────
  const newMs = toMs(newIso);

  // 1) 기록 순서가 뒤집히는가
  const orderOf = (list) => sortEvents(list).map((row) => String(row.id));
  const beforeOrder = orderOf(currentEvents).join('>');
  const afterOrder = orderOf(projectedEvents).join('>');
  if (beforeOrder !== afterOrder) {
    warnings.push(`이 수정으로 출결 기록의 순서가 바뀝니다. (${label} 기록이 다른 기록보다 앞이나 뒤로 이동합니다)`);
  }

  // 2) 입실보다 이른 / 퇴실보다 늦은 기록
  const firstCheckIn = afterDerived.sorted.find((row) => row.event_type === 'check_in');
  const lastCheckOut = [...afterDerived.sorted].reverse().find((row) => row.event_type === 'check_out');
  if (event.event_type !== 'check_in' && firstCheckIn && newMs < toMs(eventTime(firstCheckIn))) {
    warnings.push(`입실(${formatKstHm(eventTime(firstCheckIn))})보다 이른 시각입니다. ${label}이 입실 전에 일어난 것으로 기록됩니다.`);
  }
  if (event.event_type !== 'check_out' && lastCheckOut && newMs > toMs(eventTime(lastCheckOut))) {
    warnings.push(`퇴실(${formatKstHm(eventTime(lastCheckOut))})보다 늦은 시각입니다. ${label}이 퇴실 후에 일어난 것으로 기록됩니다.`);
  }

  // 3) 입실과 퇴실이 뒤집히는가
  if (after.checkInAt && after.checkOutAt && toMs(after.checkInAt) >= toMs(after.checkOutAt)) {
    warnings.push(`입실(${formatKstHm(after.checkInAt)})이 퇴실(${formatKstHm(after.checkOutAt)})보다 늦거나 같아집니다. 순공시간이 0분이 됩니다.`);
  }

  // 4) 짝이 맞지 않는 외출
  if (!beforeSession.away_started_at && afterSession.away_started_at) {
    warnings.push(`복귀하지 않은 외출이 생깁니다. (${formatKstHm(afterSession.away_started_at)} 이후 계속 외출 중으로 계산됩니다)`);
  }

  // 5) 퇴실 기록이 풀리는가
  if (beforeSession.check_out_at && !afterSession.check_out_at) {
    warnings.push('퇴실 시각이 사라집니다. 이 수정으로 퇴실 뒤에 다른 기록이 오게 되어, 아직 재실 중인 것으로 계산됩니다.');
  }

  // 6) 순공시간 / 외출 누적 변화
  if (after.pureStudyMinutes !== before.pureStudyMinutes) {
    const delta = after.pureStudyMinutes - before.pureStudyMinutes;
    warnings.push(`순공시간이 ${formatMinutesKo(before.pureStudyMinutes)} → ${formatMinutesKo(after.pureStudyMinutes)} 로 바뀝니다. (${delta > 0 ? '+' : '-'}${formatMinutesKo(Math.abs(delta))})`);
  }
  if (after.awayMinutes !== before.awayMinutes) {
    warnings.push(`외출 누적이 ${formatMinutesKo(before.awayMinutes)} → ${formatMinutesKo(after.awayMinutes)} 로 바뀝니다.`);
  }
  if (before.pureStudyMinutes > 0 && after.pureStudyMinutes === 0) {
    warnings.push('이 수정 후 순공시간이 0분이 됩니다. 시각을 다시 확인하세요.');
  }

  // 7) 학습 인정 구간 밖
  if (getStudyWindowMinutesBetween(newIso, new Date(newMs + 60000).toISOString(), studyWindows) === 0) {
    warnings.push(`${after.time} 은 학습 인정 구간 밖입니다. (설정 · 기본 시간표에서 정한 구간) 순공시간 계산에 반영되지 않는 시각입니다.`);
  }

  // 8) 아직 오지 않은 시각
  const nowMs = toMs(nowIso);
  if (nowMs !== null && newMs > nowMs) {
    warnings.push('아직 오지 않은 시각입니다. 미래 시각으로 기록됩니다.');
  }

  // 9) 키오스크가 남긴 기록
  if (String(event.source_type || '') === 'kiosk') {
    warnings.push('키오스크가 자동으로 남긴 기록입니다. 고치면 학생이 실제로 태그한 시각과 달라집니다.');
  }

  return {
    ok: true,
    blocked,
    warnings,
    before,
    after,
    projectedSession: afterSession,
    projectedEvents,
  };
}
