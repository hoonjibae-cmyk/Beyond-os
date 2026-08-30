// Beyond OS v40-112
// 순공시간 산출 기준:
// - 기본 학습 인정 구간은 설정 > 기본 시간표 설정에서 변경 가능합니다.
// - 학습 인정 구간에 포함되지 않는 시간은 점심/저녁/쉬는시간으로 보고 순공시간에서 제외합니다.

import { FALLBACK_DEFAULT_SCHEDULE_SETTINGS, normalizeDefaultScheduleSettings } from './defaultSchedule';

export const DEFAULT_STUDY_TIME_WINDOWS = FALLBACK_DEFAULT_SCHEDULE_SETTINGS.studyWindows;

function timeToMinutes(time) {
  const raw = String(time || '').trim();
  if (raw === '24:00') return 24 * 60;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getStudyWindowsMinutes(studyWindows = DEFAULT_STUDY_TIME_WINDOWS) {
  const windows = normalizeDefaultScheduleSettings({ studyWindows }).studyWindows;
  return windows
    .map((item) => ({
      ...item,
      startMinute: timeToMinutes(item.start),
      endMinute: timeToMinutes(item.end),
    }))
    .filter((item) => item.startMinute !== null && item.endMinute !== null && item.endMinute > item.startMinute);
}

function toAbsoluteKstMinute(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;

  // KST는 DST가 없으므로 UTC 기준 분에 +9시간을 더해 일자/분 단위 계산을 안정화합니다.
  return Math.round(time / 60000 + 9 * 60);
}

export function getStudyWindowMinutesBetween(startIso, endIso, studyWindows = DEFAULT_STUDY_TIME_WINDOWS) {
  const startAbs = toAbsoluteKstMinute(startIso);
  const endAbs = toAbsoluteKstMinute(endIso);
  if (startAbs === null || endAbs === null || endAbs <= startAbs) return 0;

  let total = 0;
  const firstDay = Math.floor(startAbs / 1440);
  const lastDay = Math.floor((endAbs - 1) / 1440);

  for (let day = firstDay; day <= lastDay; day += 1) {
    const dayStart = day * 1440;
    for (const window of getStudyWindowsMinutes(studyWindows)) {
      const windowStart = dayStart + window.startMinute;
      const windowEnd = dayStart + window.endMinute;
      const overlapStart = Math.max(startAbs, windowStart);
      const overlapEnd = Math.min(endAbs, windowEnd);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
  }

  return Math.max(0, Math.round(total));
}

function diffMinutesIso(startIso, endIso) {
  const startAbs = toAbsoluteKstMinute(startIso);
  const endAbs = toAbsoluteKstMinute(endIso);
  if (startAbs === null || endAbs === null || endAbs <= startAbs) return 0;
  return endAbs - startAbs;
}

export function buildAwayIntervalsFromEvents(events = [], session = {}, nowIso = new Date().toISOString()) {
  const rows = Array.isArray(events) ? [...events] : [];
  rows.sort((a, b) => new Date(a.event_at || a.created_at || 0).getTime() - new Date(b.event_at || b.created_at || 0).getTime());

  const intervals = [];
  let currentAwayStart = null;
  // v41-233: 퇴실했다가 다시 입실한 구간도 자리에 없던 시간입니다.
  //
  // 지금까지는 외출(away) → 복귀(return) 만 자리비움으로 봤습니다. 그런데 하루에
  // 퇴실 후 재입실하는 경우가 있고(예: 09:38 입실 → 11:24 퇴실 → 19:39 재입실
  // → 19:41 퇴실), 그 사이 8시간을 아무도 빼지 않아 순공시간이 8시간 3분으로
  // 잡혔습니다. 실제로 앉아 있던 시간은 2시간이 안 됩니다.
  //
  // 키오스크는 이 구간을 session.away_total_minutes 에는 이미 더해 두고 있습니다.
  // 다만 화면과 리포트는 이벤트로 다시 계산하는 경로를 쓰는데(아래
  // calculateScheduledPureStudyMinutes 의 events 분기), 재입실은 away 이벤트를
  // 남기지 않아 그 계산에서는 0분이 빠졌습니다. 그래서 계산의 근거가 되는
  // 이벤트 해석 자체를 고칩니다. 이러면 순공시간·외출 표시·리포트가 모두 맞습니다.
  let lastCheckOutAt = null;

  for (const event of rows) {
    const type = event.event_type;
    const eventAt = event.event_at || event.created_at;
    if (!eventAt) continue;

    if (type === 'away') {
      if (!currentAwayStart) currentAwayStart = eventAt;
      lastCheckOutAt = null;
    }

    if (type === 'return' && currentAwayStart) {
      intervals.push({ start: currentAwayStart, end: eventAt });
      currentAwayStart = null;
    }

    if (type === 'check_out') {
      if (currentAwayStart) {
        intervals.push({ start: currentAwayStart, end: eventAt });
        currentAwayStart = null;
      }
      lastCheckOutAt = eventAt;
    }

    // 퇴실 뒤에 다시 들어온 경우, 퇴실~재입실 사이를 자리비움으로 셉니다.
    // (return 은 위에서 외출 복귀로 처리되므로, 외출 중이 아니었을 때만 봅니다)
    if ((type === 'check_in' || type === 'return') && lastCheckOutAt) {
      intervals.push({ start: lastCheckOutAt, end: eventAt });
      lastCheckOutAt = null;
    }
  }

  if (currentAwayStart) {
    intervals.push({ start: currentAwayStart, end: session.check_out_at || nowIso });
  } else if (session.away_started_at && !session.check_out_at) {
    const hasOpenAway = intervals.some((interval) => interval.start === session.away_started_at && !interval.end);
    if (!hasOpenAway) intervals.push({ start: session.away_started_at, end: nowIso });
  }

  return intervals.filter((interval) => interval.start && interval.end);
}

function getAwayStudyWindowMinutesFromIntervals(intervals = [], studyWindows = DEFAULT_STUDY_TIME_WINDOWS) {
  return (intervals || []).reduce((sum, interval) => {
    return sum + getStudyWindowMinutesBetween(interval.start, interval.end, studyWindows);
  }, 0);
}

export function calculateScheduledPureStudyMinutes(session = {}, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  if (!session?.check_in_at) return Number(session?.pure_study_minutes || 0);

  const endIso = session.check_out_at || nowIso;
  const studyWindows = options.studyWindows || DEFAULT_STUDY_TIME_WINDOWS;
  const baseStudyMinutes = getStudyWindowMinutesBetween(session.check_in_at, endIso, studyWindows);

  const hasEventSource = Array.isArray(options.events) || Array.isArray(options.awayIntervals);
  const awayIntervals = Array.isArray(options.awayIntervals)
    ? options.awayIntervals
    : (Array.isArray(options.events) ? buildAwayIntervalsFromEvents(options.events, session, nowIso) : null);

  let awayMinutesToSubtract = 0;
  if (awayIntervals && (awayIntervals.length || hasEventSource)) {
    awayMinutesToSubtract = getAwayStudyWindowMinutesFromIntervals(awayIntervals, studyWindows);
  } else {
    const currentAwayMinutes = session.away_started_at && !session.check_out_at
      ? diffMinutesIso(session.away_started_at, endIso)
      : 0;
    awayMinutesToSubtract = Number(session.away_total_minutes || 0) + currentAwayMinutes;
  }

  return Math.max(0, Math.round(baseStudyMinutes - awayMinutesToSubtract));
}

export function calculateScheduledAwayMinutes(session = {}, nowIso = new Date().toISOString()) {
  if (!session) return 0;
  const currentAwayMinutes = session.away_started_at && !session.check_out_at
    ? diffMinutesIso(session.away_started_at, session.check_out_at || nowIso)
    : 0;
  return Math.max(0, Number(session.away_total_minutes || 0) + currentAwayMinutes);
}
