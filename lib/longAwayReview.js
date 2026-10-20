// Beyond OS v41-275
// 자율학습 중 장시간 외출 — 다음 날 벌점 확인 명단을 만드는 공용 로직입니다.
//
// 규칙 (부원장님 지시)
//   - 자율학습 = 관리 차시 밖의 자습 시간.
//     v41-275.1: 고정값이 아니라 그 날짜에 적용되는 기수별 기본 시간표에서 가져옵니다.
//       1) 기본 시간표 차시 중 이름에 '자율'·'자습'·'자유'가 들어간 차시 (예: 자율학습 22:00~24:00)
//       2) 그런 차시가 없으면 마지막 관리 차시 끝 ~ 기본 하원 시각
//       3) 그래도 없으면 lib/selfStudyHours.js 의 예전 고정값
//     휴무일(운영 안 함)은 자율학습이 없습니다.
//   - 외출 시작(away) → 외출 복귀(return) 로 닫힌 구간만 봅니다.
//     외출 뒤 복귀 없이 퇴실·자동 퇴실된 구간은 세지 않습니다.
//   - 그 구간 중 자율학습 시간대에 겹치는 분이 기준(기본 40분) 이상이면 명단에 올립니다.
//   - 벌점 부여 여부는 사람이 정합니다. 여기서는 후보만 고릅니다.
//     시간표에 미리 잡아 둔 외출(저녁식사 등)과 겹치면 그 사실을 함께 적어 둡니다.

import { getSelfStudyWindow } from './selfStudyHours';

export const LONG_AWAY_SQL_HINT = 'beyond-os-supabase-long-away-reviews-v41-275.sql 실행 여부를 확인하세요.';

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// ISO 시각 → 기준 날짜(KST 자정)부터 지난 분. 다음날 00:30 이면 1470 입니다.
export function isoToMinutesSinceDate(iso, dateString) {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  const base = new Date(`${String(dateString || '').slice(0, 10)}T00:00:00+09:00`).getTime();
  if (Number.isNaN(time) || Number.isNaN(base)) return null;
  return (time - base) / 60000;
}

export function minutesToClock(minutes) {
  const value = Math.round(Number(minutes) || 0);
  const h = Math.floor(((value % 1440) + 1440) % 1440 / 60);
  const m = ((value % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? end - start : 0;
}

function clockToMinutes24(value) {
  const raw = String(value || '').trim();
  if (raw === '24:00') return 1440;
  return timeToMinutes(raw);
}

export const SELF_STUDY_LABEL_PATTERN = /(자율|자습|자유)/;

/** 요일 유형의 자율학습 시간대(예전 고정값)를 분 구간으로. 없으면 null */
export function selfStudyRangeForDayType(dayType) {
  const window = getSelfStudyWindow(dayType);
  if (!window) return null;
  const start = timeToMinutes(window.start);
  const end = clockToMinutes24(window.end);
  if (start === null || end === null || end <= start) return null;
  return { start, end, label: `${window.start}~${window.end}` };
}

/**
 * 그 날짜의 기본 시간표(기수별 설정 반영)에서 자율학습 구간을 뽑습니다.
 *
 * @param {object} dayInfo  resolveScheduleForDate() 결과: { dayType, operating, plannedCheckOut, studyWindows }
 * @returns {{ ranges: Array<{start,end,label}>, source: 'window'|'tail'|'legacy'|'none' }}
 */
export function resolveSelfStudyRanges(dayInfo = {}) {
  if (dayInfo && dayInfo.operating === false) return { ranges: [], source: 'none' };
  const windows = Array.isArray(dayInfo?.studyWindows) ? dayInfo.studyWindows : [];

  // 1) 이름이 자율학습인 차시
  const named = windows
    .filter((item) => SELF_STUDY_LABEL_PATTERN.test(String(item?.label || '')))
    .map((item) => {
      const start = timeToMinutes(item.start);
      const end = clockToMinutes24(item.end);
      if (start === null || end === null || end <= start) return null;
      return { start, end, label: `${item.start}~${item.end}` };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (named.length) return { ranges: named, source: 'window' };

  // 2) 마지막 관리 차시 끝 ~ 기본 하원
  const ends = windows.map((item) => clockToMinutes24(item?.end)).filter((value) => value !== null);
  const checkOut = clockToMinutes24(dayInfo?.plannedCheckOut);
  if (ends.length && checkOut !== null) {
    const lastEnd = Math.max(...ends);
    if (checkOut > lastEnd) return { ranges: [{ start: lastEnd, end: checkOut, label: `${minutesToClock(lastEnd)}~${checkOut === 1440 ? '24:00' : minutesToClock(checkOut)}` }], source: 'tail' };
  }

  // 3) 예전 고정값
  const legacy = selfStudyRangeForDayType(dayInfo?.dayType || 'weekday');
  return legacy ? { ranges: [legacy], source: 'legacy' } : { ranges: [], source: 'none' };
}

/**
 * 한 세션의 이벤트에서 '외출 → 복귀'로 닫힌 구간만 뽑습니다.
 * 퇴실(check_out)·재입실(check_in)이 끼면 열린 외출은 버립니다.
 */
export function collectClosedAwayIntervals(events = []) {
  const rows = [...(events || [])]
    .filter((event) => event && (event.event_at || event.created_at))
    .sort((a, b) => new Date(a.event_at || a.created_at).getTime() - new Date(b.event_at || b.created_at).getTime());
  const intervals = [];
  let open = null;
  for (const event of rows) {
    const at = event.event_at || event.created_at;
    const type = String(event.event_type || '');
    if (type === 'away') {
      if (!open) open = { awayEvent: event, start: at };
      continue;
    }
    if (type === 'return') {
      if (open) {
        intervals.push({ awayEvent: open.awayEvent, returnEvent: event, start: open.start, end: at });
        open = null;
      }
      continue;
    }
    if (type === 'check_out' || type === 'check_in') open = null;
  }
  return intervals;
}

/**
 * 명단 후보를 만듭니다.
 *
 * @param {object} options
 *   date               YYYY-MM-DD (운영일)
 *   dayInfo            resolveScheduleForDate() 결과 (기수별 기본 시간표). 없으면 dayType 고정값으로 폴백
 *   dayType            'weekday' | 'saturday' | 'sunday' | 'holiday' (dayInfo 가 없을 때만)
 *   sessions           daily_sessions 행 (student 정보 포함 가능: session.students)
 *   eventsBySession    { [sessionId]: attendance_events[] }
 *   breaksByStudent    { [studentId]: [{ leave_start, return_time, reason, reason_detail }] }  그날 시간표 외출
 *   thresholdMinutes   기본 40
 */
export function findLongAwayCandidates({
  date,
  dayInfo = null,
  dayType = 'weekday',
  sessions = [],
  eventsBySession = {},
  breaksByStudent = {},
  thresholdMinutes = 40,
} = {}) {
  const resolved = dayInfo ? resolveSelfStudyRanges(dayInfo) : resolveSelfStudyRanges({ dayType, studyWindows: [], plannedCheckOut: '' });
  const ranges = resolved.ranges;
  const threshold = Math.max(1, Number(thresholdMinutes) || 40);
  const selfStudyLabel = ranges.map((item) => item.label).join(', ');
  if (!ranges.length) return { candidates: [], selfStudyLabel: '', selfStudySource: resolved.source, reason: 'no_self_study' };

  const candidates = [];
  for (const session of sessions || []) {
    if (!session || !session.id || !session.check_in_at) continue;
    if (session.seat_status === 'absent') continue;
    const studentId = String(session.student_id || '');
    const events = eventsBySession[session.id] || eventsBySession[String(session.id)] || [];
    const intervals = collectClosedAwayIntervals(events);
    for (const interval of intervals) {
      const startMin = isoToMinutesSinceDate(interval.start, date);
      const endMin = isoToMinutesSinceDate(interval.end, date);
      if (startMin === null || endMin === null || endMin <= startMin) continue;
      const awayMinutes = Math.round(endMin - startMin);
      const selfStudyMinutes = Math.round(ranges.reduce((sum, range) => sum + overlapMinutes(startMin, endMin, range.start, range.end), 0));
      if (selfStudyMinutes < threshold) continue;

      // 시간표에 미리 잡힌 외출과 겹치는지 (겹치면 '사유 있음' 판단에 참고)
      const planned = (breaksByStudent[studentId] || [])
        .map((item) => {
          const ls = timeToMinutes(item.leave_start);
          const rt = timeToMinutes(item.return_time);
          if (ls === null || rt === null || rt <= ls) return null;
          const overlap = overlapMinutes(startMin, endMin, ls, rt);
          if (overlap <= 0) return null;
          const reason = [item.reason, item.reason_detail].filter(Boolean).join(' · ');
          return `${reason || '외출'} ${minutesToClock(ls)}~${minutesToClock(rt)}`;
        })
        .filter(Boolean);

      candidates.push({
        key: `${session.id}:${interval.awayEvent.id}`,
        studentId,
        sessionId: String(session.id),
        sessionDate: date,
        name: session.students?.name || session.student_name || '학생',
        subtitle: [session.students?.school, session.students?.grade].filter(Boolean).join(' '),
        awayEventId: String(interval.awayEvent.id),
        returnEventId: String(interval.returnEvent.id),
        awayStartedAt: interval.start,
        returnedAt: interval.end,
        awayLabel: `${minutesToClock(startMin)}~${minutesToClock(endMin)}`,
        awayMinutes,
        selfStudyMinutes,
        memo: String(interval.awayEvent.memo || '').trim(),
        plannedBreaks: planned,
      });
    }
  }
  candidates.sort((a, b) => b.selfStudyMinutes - a.selfStudyMinutes || String(a.name).localeCompare(String(b.name), 'ko'));
  return { candidates, selfStudyLabel, selfStudySource: resolved.source, reason: '' };
}

/** 벌점 기록의 사유 문구 */
export function buildLongAwayPenaltyReason(candidate) {
  return `자율학습 중 장시간 외출 ${candidate.awayMinutes}분 (${candidate.awayLabel})`;
}

/** 기준일 기본값: 오늘의 전날 (다음 날 아침에 전날 것을 확인) */
export function previousDateString(dateString) {
  const d = new Date(`${dateString}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
