import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

function formatKstTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function toDate(value, fallback) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function calculateLivePureStudyMinutes(session = {}, events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { events, studyWindows });
}

function eventLabel(type) {
  const map = {
    check_in: '등원',
    away: '외출',
    return: '복귀',
    check_out: '하원',
    absent: '결석',
    needs_attention: '관리필요',
    manual_edit: '수동수정',
  };
  return map[type] || type || '-';
}

function stripAttendanceReasonPrefix(value, label = '') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const cleanLabel = String(label || '').trim();
  if (cleanLabel) {
    for (const prefix of [`${cleanLabel} 사유:`, `${cleanLabel} 사유：`, `${cleanLabel}:`, `${cleanLabel}：`]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
  }
  if (raw.startsWith('결석 사유:')) return raw.slice('결석 사유:'.length).trim();
  return raw;
}

function reasonLabelForEvent(event = {}) {
  const type = event.event_type || '';
  if (type === 'check_in') return '지각';
  if (type === 'check_out') return '조퇴';
  if (type === 'absent') return '결석';
  return eventLabel(type);
}

function getEventReason(event = {}) {
  return stripAttendanceReasonPrefix(event.memo || '', reasonLabelForEvent(event));
}

function sourceLabelForEvent(event = {}) {
  if (event.source_type === 'kiosk') return event.source_label || '키오스크 자동 기록';
  return event.source_label || '관리자 수동 기록';
}

function formatEventSummaryPart(event = {}) {
  const reason = getEventReason(event);
  const label = eventLabel(event.event_type);
  const source = sourceLabelForEvent(event);
  return `${formatKstTime(event.event_at)} ${label}${reason ? `(${reason})` : ''} [${source}]`;
}

function getLatestEventReason(events = [], eventType = '', label = '') {
  const rows = (events || [])
    .filter((event) => event?.event_type === eventType && String(event.memo || '').trim())
    .sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));
  return stripAttendanceReasonPrefix(rows[0]?.memo || '', label);
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const start = toDate(searchParams.get('start'), today);
    const end = toDate(searchParams.get('end'), today);
    const studentId = searchParams.get('studentId') || 'all';

    let query = supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .gte('session_date', start)
      .lte('session_date', end)
      .order('session_date', { ascending: false })
      .order('seat_no', { ascending: true });

    if (studentId !== 'all') query = query.eq('student_id', studentId);

    const { data: sessions, error: sessionsError } = await query;
    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions || []).map((session) => session.id);
    let events = [];
    let reports = [];
    let schedules = [];

    // v41-42: 전체 학생 보기에서도 지각/조퇴 판정이 가능하도록 기간 내 개인 시간표를 항상 조회합니다.
    try {
      let scheduleQuery = supabase
        .from('student_daily_schedules')
        .select('*')
        .gte('schedule_date', start)
        .lte('schedule_date', end);
      if (studentId !== 'all') scheduleQuery = scheduleQuery.eq('student_id', studentId);
      const { data: scheduleRows, error: schedulesError } = await scheduleQuery;
      if (!schedulesError) schedules = scheduleRows || [];
    } catch {
      schedules = [];
    }

    if (sessionIds.length) {
      const { data: eventRows, error: eventsError } = await supabase
        .from('attendance_events')
        .select('*')
        .in('session_id', sessionIds)
        .order('event_at', { ascending: true });
      if (eventsError) throw eventsError;
      events = eventRows || [];

      const { data: reportRows, error: reportsError } = await supabase
        .from('daily_reports')
        .select('*')
        .in('session_id', sessionIds);
      if (!reportsError) reports = reportRows || [];
    }

    const eventsBySession = {};
    for (const event of events || []) {
      if (!eventsBySession[event.session_id]) eventsBySession[event.session_id] = [];
      eventsBySession[event.session_id].push(event);
    }

    const reportsBySession = {};
    for (const report of reports || []) reportsBySession[report.session_id] = report;

    const schedulesByStudentDate = {};
    for (const schedule of schedules || []) schedulesByStudentDate[`${schedule.student_id}|${schedule.schedule_date}`] = schedule;

    const rows = (sessions || []).map((session) => {
      const sessionEvents = eventsBySession[session.id] || [];
      const awayEvents = sessionEvents.filter((event) => ['away', 'return'].includes(event.event_type));
      const awayMinutes = Math.max(
        0,
        Number(session.away_total_minutes || 0) + (session.away_started_at ? diffMinutes(session.away_started_at, session.check_out_at || new Date().toISOString()) : 0)
      );
      const awayCount = sessionEvents.filter((event) => event.event_type === 'away').length || (awayMinutes > 0 ? 1 : 0);
      const eventSummary = sessionEvents
        .map(formatEventSummaryPart)
        .join(' / ');
      const awaySummary = awayEvents.length
        ? awayEvents.map(formatEventSummaryPart).join(' / ')
        : (awayMinutes > 0 ? `${awayMinutes}분` : '-');
      const report = reportsBySession[session.id] || {};
      const schedule = schedulesByStudentDate[`${session.student_id}|${session.session_date}`] || {};
      const defaultSchedule = resolveScheduleForDate(scheduleConfig, session.session_date || today);

      return {
        id: session.id,
        date: session.session_date,
        studentId: session.student_id,
        studentName: session.students?.name || '-',
        school: session.students?.school || '',
        grade: session.students?.grade || '',
        seatNo: session.seat_no,
        status: session.seat_status,
        checkInAt: session.check_in_at,
        checkOutAt: session.check_out_at,
        checkInTime: formatKstTime(session.check_in_at),
        checkOutTime: session.check_out_at ? formatKstTime(session.check_out_at) : '',
        awayMinutes,
        awayCount,
        awaySummary,
        pureStudyMinutes: calculateLivePureStudyMinutes(session, sessionEvents, defaultSchedule.studyWindows),
        // v41-42: 개인 시간표가 없는 날짜는 예정 등하원을 비워 지각/조퇴 판정에서 제외합니다.
        plannedCheckIn: schedule.planned_check_in || '',
        plannedCheckOut: schedule.planned_check_out || '',
        plannedCheckInTime: schedule.planned_check_in || '',
        plannedCheckOutTime: schedule.planned_check_out || '',
        scheduleNote: schedule.schedule_note || '',
        mentorComment: report.mentor_comment || '',
        attendanceMemo: session.attendance_memo || '',
        eventSummary,
        attendanceIssueReasons: {
          결석: getLatestEventReason(sessionEvents, 'absent', '결석'),
          지각: getLatestEventReason(sessionEvents, 'check_in', '지각'),
          조퇴: getLatestEventReason(sessionEvents, 'check_out', '조퇴'),
        },
        absentReason: getLatestEventReason(sessionEvents, 'absent', '결석'),
        lateReason: getLatestEventReason(sessionEvents, 'check_in', '지각'),
        earlyLeaveReason: getLatestEventReason(sessionEvents, 'check_out', '조퇴'),
      };
    });

    return Response.json({ start, end, studentId, rows });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}


export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const sessionId = body.sessionId;
    const mentorComment = String(body.mentorComment || '').trim();

    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;

    const { data: existingReport, error: existingError } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existingError) throw existingError;

    let report;
    if (existingReport?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('daily_reports')
        .update({
          mentor_comment: mentorComment || null,
        })
        .eq('id', existingReport.id)
        .select()
        .single();

      if (updateError) throw updateError;
      report = updated;
    } else {
      const student = session.students || {};
      const fallbackText = `[비욘드 데일리 리포트]\n\n학생: ${student.name || '-'}\n날짜: ${session.session_date || getKstDateString()}\n\n학습멘토 코멘트\n${mentorComment || '-'}`;

      const { data: inserted, error: insertError } = await supabase
        .from('daily_reports')
        .insert({
          session_id: session.id,
          student_id: session.student_id,
          report_date: session.session_date,
          report_text: fallbackText,
          mentor_comment: mentorComment || null,
          send_status: 'draft',
          sent_channel: 'kakao_copy',
          created_by: body.adminName || '관리자',
        })
        .select()
        .single();

      if (insertError) throw insertError;
      report = inserted;
    }

    return Response.json({
      ok: true,
      report,
      sessionId,
      mentorComment: report.mentor_comment || '',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
