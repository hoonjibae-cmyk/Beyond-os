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

  for (const event of rows) {
    const type = event.event_type;
    const eventAt = event.event_at || event.created_at;
    if (!eventAt) continue;

    if (type === 'away') {
      if (!currentAwayStart) currentAwayStart = eventAt;
    }

    if (type === 'return' && currentAwayStart) {
      intervals.push({ start: currentAwayStart, end: eventAt });
      currentAwayStart = null;
    }

    if (type === 'check_out' && currentAwayStart) {
      intervals.push({ start: currentAwayStart, end: eventAt });
      currentAwayStart = null;
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
