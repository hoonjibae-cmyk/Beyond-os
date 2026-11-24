import { buildAwayIntervalsFromEvents, calculateScheduledPureStudyMinutes } from './studyTime.js';

// Include the pending transition when calculating the session that will be saved.
export function projectManualAttendanceEvents(events = [], {
  resetEvents = false, removeAbsent = false, convertLastCheckout = false, eventType, eventAt,
} = {}) {
  const projected = resetEvents ? [] : events.filter((event) => !removeAbsent || event.event_type !== 'absent').map((event) => ({ ...event }));
  if (convertLastCheckout) {
    const last = projected.filter((event) => event.event_type === 'check_out')
      .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())[0];
    if (last) last.event_type = 'away';
  }
  if (eventType) projected.push({ event_type: eventType, event_at: eventAt });
  return projected;
}

export function calculateManualAttendanceStudyMinutes(session, { events = [], nowIso, studyWindows, useEvents = true } = {}) {
  if (session.seat_status === 'absent') return 0;
  const intervals = buildAwayIntervalsFromEvents(events, session, nowIso);
  // Legacy records with only a manually entered total have no timed intervals.
  const hasTimedAbsence = intervals.length > 0;
  const eventOptions = useEvents && (hasTimedAbsence || !Number(session.away_total_minutes)) ? { awayIntervals: intervals } : {};
  return calculateScheduledPureStudyMinutes(session, { nowIso, studyWindows, ...eventOptions });
}
