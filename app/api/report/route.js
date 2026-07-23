import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { formatMinutes, getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

function formatKstDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}


function getKstMinutesFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch {}
  return null;
}

function timeToMinutes(value) {
  const raw = String(value || '').trim();
  if (raw === '24:00') return 24 * 60;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getCheckPeriodMeta(check = {}, defaultSchedule = {}) {
  const checkedMinute = getKstMinutesFromIso(check.checked_at);
  const windows = Array.isArray(defaultSchedule?.studyWindows) ? defaultSchedule.studyWindows : [];
  if (checkedMinute !== null) {
    const matched = windows
      .map((item, index) => ({
        ...item,
        index,
        startMinute: timeToMinutes(item.start),
        endMinute: timeToMinutes(item.end),
      }))
      .find((item) => item.startMinute !== null && item.endMinute !== null && checkedMinute >= item.startMinute && checkedMinute < item.endMinute);

    if (matched) {
      return {
        key: `${matched.label || matched.index}-${matched.start}-${matched.end}`,
        sortMinute: matched.startMinute,
        label: matched.label || `${matched.index + 1}차시`,
        range: `${matched.start}~${matched.end}`,
        periodText: `${matched.label || `${matched.index + 1}차시`} ${matched.start}~${matched.end}`,
        checkedAtText: formatKstDateTime(check.checked_at),
      };
    }
  }

  const fallbackTime = formatKstDateTime(check.checked_at);
  return {
    key: `check-${check.id || check.checked_at || Math.random()}`,
    sortMinute: checkedMinute ?? 9999,
    label: '순찰 체크',
    range: fallbackTime,
    periodText: `${fallbackTime} 순찰 체크`,
    checkedAtText: fallbackTime,
  };
}

function formatChecksBySchedulePeriod(checks = [], defaultSchedule = {}) {
  if (!(checks || []).length) return '순찰 체크 기록이 아직 없습니다.';

  const groups = new Map();
  for (const check of checks || []) {
    const meta = getCheckPeriodMeta(check, defaultSchedule);
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, checks: [] });
    groups.get(meta.key).checks.push(check);
  }

  return [...groups.values()]
    .sort((a, b) => a.sortMinute - b.sortMinute)
    .map((group, index) => {
      const sortedChecks = [...group.checks].sort((a, b) => new Date(a.checked_at || 0) - new Date(b.checked_at || 0));
      const statusSummary = [...new Set(sortedChecks.map((check) => [check.subject, check.study_status].filter(Boolean).join(' / ')).filter(Boolean))].join(' → ') || '학습 상태 미입력';
      // 학습 내용 및 특이사항이 없으면 '미입력' 문구를 넣지 않고 해당 줄 자체를 생략합니다.
      const contentSummary = [...new Set(sortedChecks.map((check) => String(check.study_content || '').trim()).filter(Boolean))].join(' / ');
      const checkedTimes = sortedChecks.map((check) => formatKstDateTime(check.checked_at)).filter((value) => value && value !== '-');
      const checkedNote = checkedTimes.length ? `체크 ${checkedTimes.join(', ')}` : '체크 시간 확인 불가';
      const lines = [`${index + 1}. ${group.periodText} - ${statusSummary}`];
      if (contentSummary) lines.push(`  · ${contentSummary}`);
      lines.push(`  · ${checkedNote}`);
      return lines.join('\n');
    })
    .join('\n');
}

function calculateCurrentAwayMinutes(session) {
  if (!session.away_started_at) return 0;
  return diffMinutes(session.away_started_at, new Date().toISOString());
}

function calculateTotalAwayMinutes(session) {
  return Number(session.away_total_minutes || 0) + calculateCurrentAwayMinutes(session);
}

function calculateReportPureStudyMinutes(session, events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { events, studyWindows });
}

function stripAttendanceReasonPrefix(value, label = '') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const cleanLabel = String(label || '').trim();
  if (cleanLabel) {
    for (const prefix of [`${cleanLabel} 사유:`, `${cleanLabel} 사유：`]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
  }
  return raw;
}

function getEventReason(events = [], eventType = '', label = '') {
  const rows = (events || [])
    .filter((event) => event?.event_type === eventType && String(event.memo || '').trim())
    .sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));

  return stripAttendanceReasonPrefix(rows[0]?.memo || '', label);
}

function formatIssueWithReason(label, reason) {
  const cleanLabel = String(label || '').trim();
  const cleanReason = String(reason || '').trim();
  return cleanReason ? `${cleanLabel}(${cleanReason})` : cleanLabel;
}

// 외출 이벤트 메모에서 학부모에게 보여줄 사유만 추립니다.
// 일반적인 '외출'/시스템 처리 문구(퇴실 후 재입실 등)는 사유로 보지 않습니다.
function cleanAwayReason(memo) {
  const raw = stripAttendanceReasonPrefix(String(memo || '').trim(), '외출');
  if (!raw) return '';
  if (['외출', '외출함', '잠시 외출', '자리비움', '외출 처리'].includes(raw)) return '';
  if (/재입실|재등원|자동|퇴실\s*후|HOLD|관리자\s*승인|쉬는\s*시간|수동\s*지정|승인\s*\(|처리$/i.test(raw)) return '';
  return raw;
}

// 개인 시간표 외출(student_schedule_breaks)에서 학부모용 사유 문구를 만듭니다.
function formatScheduleBreakReason(breakRow = {}) {
  const detail = String(breakRow.reason_detail || '').trim();
  const reason = String(breakRow.reason || '').trim();
  if (detail) return reason && reason !== '기타' ? `${reason}(${detail})` : detail;
  if (reason) return reason;
  return '';
}

// away 구간과 겹치는 개인 시간표 외출을 찾아(겹침이 가장 큰 것) 사유를 끌어옵니다.
function findOverlappingBreakReason(startIso, endIso, scheduleBreaks = []) {
  const startMin = getKstMinutesFromIso(startIso);
  if (startMin === null) return '';
  const endMin = endIso ? (getKstMinutesFromIso(endIso) ?? startMin + 1) : startMin + 1;
  let best = null;
  let bestOverlap = 0;
  for (const item of scheduleBreaks || []) {
    const leave = timeToMinutes(item.leave_start);
    if (leave === null) continue;
    const ret = timeToMinutes(item.return_time);
    const breakEnd = ret === null ? 1440 : ret;
    const overlap = Math.max(0, Math.min(endMin, breakEnd) - Math.max(startMin, leave));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = item;
    }
  }
  return best ? formatScheduleBreakReason(best) : '';
}

// away 이벤트를 시간 순으로 훑어 (외출~복귀) 구간과 사유를 만듭니다.
// 사유 우선순위: ① 외출 이벤트 메모 → ② 겹치는 개인 시간표 외출 → ③ 공란
function buildAwayIntervals(events = [], scheduleBreaks = []) {
  const sorted = [...(events || [])].filter((event) => event.event_at).sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
  const intervals = [];
  sorted.forEach((event, index) => {
    if (event.event_type !== 'away') return;
    const end = sorted.slice(index + 1).find((item) => ['return', 'check_in', 'check_out'].includes(item.event_type));
    const endAt = end?.event_at || null;
    const reason = cleanAwayReason(event.memo) || findOverlappingBreakReason(event.event_at, endAt, scheduleBreaks);
    intervals.push({ start: event.event_at, end: endAt, reason });
  });
  return intervals;
}

function buildAwayLine(session, events, scheduleBreaks = []) {
  const totalLabel = formatMinutes(calculateTotalAwayMinutes(session));
  const intervals = buildAwayIntervals(events, scheduleBreaks);
  // v41-113: 10분을 넘지 않는 짧은 외출은 목록/횟수에서 제외(총 외출 시간에는 반영).
  const major = intervals.filter((item) => !item.end || diffMinutes(item.start, item.end) > 10);
  const count = major.length;
  if (!count) return `외출: 총 ${totalLabel}, 0회`;
  const lines = major.map((item) => {
    const start = formatKstDateTime(item.start);
    const end = item.end ? formatKstDateTime(item.end) : '미복귀';
    const reason = item.reason ? ` · 사유: ${item.reason}` : '';
    return `  · ${start}~${end}${reason}`;
  });
  return [`외출: 총 ${totalLabel}, ${count}회(10분 초과)`, ...lines].join('\n');
}

async function getStudentPoints(supabase, studentId, startDate, endDate = startDate) {
  try {
    const { data } = await supabase
      .from('student_points')
      .select('*')
      .eq('student_id', String(studentId))
      .eq('is_deleted', false)
      .gte('point_date', startDate)
      .lte('point_date', endDate)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false });
    return data || [];
  } catch {
    return [];
  }
}

function formatPointSummary(rows = []) {
  const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  if (!rows.length) return '상벌점: 기록 없음';
  const details = rows.slice(0, 4).map((row) => `${row.point_type === 'reward' ? '상점' : '벌점'} ${row.points}점(${row.reason || '-'})`).join(', ');
  return `상벌점: 상점 ${reward}점 / 벌점 ${penalty}점${details ? ` · ${details}` : ''}`;
}

function getExitLabel(session, events = []) {
  if (session.check_out_at) return formatKstDateTime(session.check_out_at);

  if (session.seat_status === 'absent') return formatIssueWithReason('결석', getEventReason(events, 'absent', '결석'));
  if (session.seat_status === 'not_arrived') return '미입실';
  if (session.seat_status === 'away') return '외출중';
  if (session.seat_status === 'needs_attention') return '관리필요';

  return '아직 학습중';
}

function isStillStudying(session) {
  return Boolean(
    !session.check_out_at
      && session.check_in_at
      && ['occupied', 'away', 'needs_attention'].includes(session.seat_status)
  );
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);

    if (!body.sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .eq('id', body.sessionId)
      .single();

    if (sessionError) throw sessionError;

    const defaultSchedule = resolveScheduleForDate(scheduleConfig, session.session_date);

    const { data: checks, error: checksError } = await supabase
      .from('study_checks')
      .select('*')
      .eq('session_id', body.sessionId)
      .order('checked_at', { ascending: true });

    if (checksError) throw checksError;

    const { data: events, error: eventsError } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('session_id', body.sessionId);

    if (eventsError) throw eventsError;

    let plannerLabel = '플래너: 미업로드';
    let plannerImageUrl = null;
    let plannerFileName = null;
    try {
      const { data: planner } = await supabase
        .from('planner_photos')
        .select('*')
        .eq('student_id', session.student_id)
        .eq('planner_date', session.session_date)
        .maybeSingle();

      if (planner?.id) {
        plannerFileName = planner.file_name || null;
        plannerLabel = `플래너: 업로드 완료${planner.memo ? ` (${planner.memo})` : ''} · 이미지 별도 첨부`;
        const plannerPath = planner.file_path || planner.photo_url;
        if (plannerPath) {
          const { data: signed } = await supabase.storage
            .from('planner-photos')
            .createSignedUrl(plannerPath, 60 * 60 * 6);
          plannerImageUrl = signed?.signedUrl || null;
        }
      }
    } catch {
      plannerLabel = '플래너: 확인 불가';
    }

    const student = session.students;

    // 개인 시간표에 등록된 외출(사유 폴백용)을 조회합니다.
    let scheduleBreaks = [];
    try {
      const { data: scheduleRow } = await supabase
        .from('student_daily_schedules')
        .select('id')
        .eq('student_id', session.student_id)
        .eq('schedule_date', session.session_date || getKstDateString())
        .maybeSingle();
      if (scheduleRow?.id) {
        const { data: breakRows } = await supabase
          .from('student_schedule_breaks')
          .select('leave_start, return_time, reason, reason_detail')
          .eq('schedule_id', scheduleRow.id)
          .order('leave_start', { ascending: true });
        scheduleBreaks = breakRows || [];
      }
    } catch {
      scheduleBreaks = [];
    }

    const awayLine = buildAwayLine(session, events, scheduleBreaks);

    const { data: existingReport } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('session_id', body.sessionId)
      .maybeSingle();

    const checksText = formatChecksBySchedulePeriod(checks || [], defaultSchedule);

    const mentorComment = (String(body.mentorComment || '').trim() || String(existingReport?.mentor_comment || '').trim());
    const reportPureStudyMinutes = calculateReportPureStudyMinutes(session, events, defaultSchedule.studyWindows);
    const exitLabel = getExitLabel(session, events);
    const attendanceMemoLabel = session.seat_status === 'absent'
      ? formatIssueWithReason('결석', getEventReason(events, 'absent', '결석'))
      : (session.attendance_memo || '-');
    const pureStudyLabel = `${formatMinutes(reportPureStudyMinutes)}${isStillStudying(session) ? ' (계속 학습중)' : ''}`;
    const mentorBlock = mentorComment ? `\n\n학습멘토 코멘트\n${mentorComment}` : '';
    const pointRows = await getStudentPoints(supabase, student.id, session.session_date || getKstDateString());
    const pointLine = formatPointSummary(pointRows);

    const reportText = `[비욘드 데일리 리포트]\n\n학생: ${student.name}\n학교/학년: ${[student.school, student.grade].filter(Boolean).join(' ') || '-'}\n좌석: ${String(session.seat_no).padStart(2, '0')}번\n날짜: ${session.session_date || getKstDateString()}\n입실: ${formatKstDateTime(session.check_in_at)}\n퇴실: ${exitLabel}\n${awayLine}\n순공시간: ${pureStudyLabel}\n${plannerLabel}\n특이사항: ${attendanceMemoLabel || '-'}\n${pointLine}\n\n오늘의 학습 기록\n${checksText}${mentorBlock}`;

    const { data: report, error: reportError } = await supabase
      .from('daily_reports')
      .upsert({
        session_id: session.id,
        student_id: student.id,
        report_date: session.session_date,
        report_text: reportText,
        mentor_comment: mentorComment || null,
        send_status: 'draft',
        sent_channel: 'kakao_copy',
        created_by: body.adminName || '관리자',
      }, { onConflict: 'session_id' })
      .select()
      .single();

    if (reportError) throw reportError;

    return Response.json({ report, reportText, plannerImageUrl, plannerFileName, plannerImageAvailable: Boolean(plannerImageUrl) });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
