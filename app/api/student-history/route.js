import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

function toDate(value, fallback = getKstDateString()) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function formatKstTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function formatMinutes(minutes) {
  const m = Math.max(0, Number(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

function diffDaysInclusive(startDate, endDate) {
  const start = toDate(startDate, null);
  const end = toDate(endDate, null);
  if (!start || !end) return 0;
  const startMs = new Date(`${start}T00:00:00+09:00`).getTime();
  const endMs = new Date(`${end}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

function classifyWeeklyStudyVolume(totalStudyMinutes = 0, startDate, endDate) {
  const minutes = Math.max(0, Number(totalStudyMinutes || 0));
  const rangeDays = diffDaysInclusive(startDate, endDate) || 7;
  const weeklyEquivalentMinutes = Math.round((minutes / Math.max(rangeDays, 1)) * 7);
  let evaluation = '개선 필요';
  if (weeklyEquivalentMinutes > 40 * 60) evaluation = '학습량 충분';
  else if (weeklyEquivalentMinutes >= 30 * 60) evaluation = '보통';

  return {
    rule: '1주 기준 순공시간 40시간 초과=학습량 충분, 30~40시간=보통, 30시간 미만=개선 필요',
    rangeDays,
    totalStudyMinutes: minutes,
    totalStudyLabel: formatMinutes(minutes),
    weeklyEquivalentStudyMinutes: weeklyEquivalentMinutes,
    weeklyEquivalentStudyLabel: formatMinutes(weeklyEquivalentMinutes),
    evaluation,
  };
}

function sourceLabelForEvent(event = {}) {
  if (event.source_type === 'kiosk') return event.source_label || '키오스크 자동기록';
  return event.source_label || '관리자 수동기록';
}

function eventLabel(type) {
  const map = {
    check_in: '입실',
    check_out: '퇴실',
    away: '외출',
    return: '복귀',
    absent: '결석',
    manual_edit: '수정',
    needs_attention: '관리필요',
  };
  return map[type] || type || '-';
}

function safeList(list) {
  return Array.isArray(list) ? list : [];
}

function byKey(rows = [], key) {
  const map = {};
  for (const row of rows || []) {
    const value = row?.[key];
    if (!value) continue;
    if (!map[value]) map[value] = [];
    map[value].push(row);
  }
  return map;
}

function safeText(value, max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function makeIsoStart(date) {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

function makeIsoEnd(date) {
  return new Date(`${date}T23:59:59+09:00`).toISOString();
}

async function safeSelect(label, fn, fallback = []) {
  try {
    const { data, error } = await fn();
    if (error) return { rows: fallback, warning: `${label}: ${error.message}` };
    return { rows: data || fallback, warning: null };
  } catch (error) {
    return { rows: fallback, warning: `${label}: ${error.message || '조회 실패'}` };
  }
}

function summarizeStudyChecks(checks = []) {
  const subjectCounts = {};
  const statusCounts = {};
  for (const check of checks || []) {
    const subject = check.subject || '미분류';
    const status = check.study_status || '미분류';
    subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const topSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
  const topStatus = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
  return { subjectCounts, statusCounts, topSubject, topStatus };
}

function getTimelineRows({ sessions = [], eventsBySession = {}, checksBySession = {}, reportsBySession = {}, plannersByDate = {}, acksByDate = {}, attendanceNotificationsByDate = {}, parentNotificationsByDate = {}, weeklyReports = [], scheduleConfig }) {
  const rows = [];

  for (const session of sessions || []) {
    const daySchedule = resolveScheduleForDate(scheduleConfig, session.session_date);
    const sessionEvents = eventsBySession[session.id] || [];
    const sessionChecks = checksBySession[session.id] || [];
    const report = reportsBySession[session.id] || null;
    const planner = plannersByDate[session.session_date] || null;
    const acks = acksByDate[session.session_date] || [];
    const attendanceNotifications = attendanceNotificationsByDate[session.session_date] || [];
    const parentNotifications = parentNotificationsByDate[session.session_date] || [];
    const awayMinutes = Math.max(
      0,
      Number(session.away_total_minutes || 0) + (session.away_started_at ? diffMinutes(session.away_started_at, session.check_out_at || new Date().toISOString()) : 0)
    );
    const pureStudyMinutes = calculateScheduledPureStudyMinutes(session, {
      events: sessionEvents,
      studyWindows: daySchedule?.studyWindows,
    });
    const studySummary = summarizeStudyChecks(sessionChecks);

    const eventSummary = sessionEvents
      .sort((a, b) => new Date(a.event_at || a.created_at || 0) - new Date(b.event_at || b.created_at || 0))
      .map((event) => `${formatKstTime(event.event_at)} ${eventLabel(event.event_type)} · ${sourceLabelForEvent(event)}${event.memo ? ` · ${safeText(event.memo, 80)}` : ''}`)
      .join(' / ');

    const periodSummary = sessionChecks
      .sort((a, b) => new Date(a.checked_at || a.created_at || 0) - new Date(b.checked_at || b.created_at || 0))
      .map((check) => `${formatKstTime(check.checked_at || check.created_at)} ${check.subject || '-'} / ${check.study_status || '-'}${check.study_content ? ` · ${safeText(check.study_content, 50)}` : ''}`)
      .join(' / ');

    rows.push({
      date: session.session_date,
      sessionId: session.id,
      seatNo: session.seat_no,
      status: session.seat_status,
      attendanceSummary: [
        session.check_in_at ? `입실 ${formatKstTime(session.check_in_at)}` : '입실 -',
        session.check_out_at ? `퇴실 ${formatKstTime(session.check_out_at)}` : (session.seat_status === 'absent' ? '결석' : '퇴실 -'),
        awayMinutes ? `외출 ${formatMinutes(awayMinutes)}` : '',
      ].filter(Boolean).join(' / '),
      checkInTime: formatKstTime(session.check_in_at),
      checkOutTime: formatKstTime(session.check_out_at),
      pureStudyMinutes,
      pureStudyLabel: formatMinutes(pureStudyMinutes),
      awayMinutes,
      awayLabel: formatMinutes(awayMinutes),
      studyCheckCount: sessionChecks.length,
      topSubject: studySummary.topSubject,
      topStudyStatus: studySummary.topStatus,
      periodSummary: periodSummary || '-',
      observation: safeText(report?.mentor_comment || session.attendance_memo || '', 220),
      mentorComment: safeText(report?.mentor_comment || '', 240),
      attendanceMemo: safeText(session.attendance_memo || '', 200),
      plannerMemo: safeText(planner?.memo || '', 180),
      plannerStatus: planner ? '제출' : '미제출',
      focusIssues: acks.map((ack) => ack.alert_title || ack.alert_type || '관리주의').join(' / ') || '-',
      focusCount: acks.length,
      alertCount: attendanceNotifications.length + parentNotifications.length,
      reportStatus: report?.sent_at ? '데일리 발송완료' : (report ? '데일리 작성' : '데일리 없음'),
      reportId: report?.id || null,
      eventSummary: eventSummary || '-',
      details: {
        events: sessionEvents,
        checks: sessionChecks,
        report,
        planner,
        acknowledgements: acks,
        attendanceNotifications,
        parentNotifications,
      },
    });
  }

  for (const weekly of weeklyReports || []) {
    rows.push({
      date: `${weekly.start_date}~${weekly.end_date}`,
      sessionId: null,
      kind: 'weekly',
      attendanceSummary: '위클리 리포트',
      pureStudyMinutes: Number(weekly.summary_payload?.totalStudyMinutes || weekly.summary_payload?.totalStudy || 0),
      pureStudyLabel: formatMinutes(Number(weekly.summary_payload?.totalStudyMinutes || weekly.summary_payload?.totalStudy || 0)),
      observation: safeText(weekly.final_weekly_comment || weekly.ai_weekly_comment || weekly.report_text || '', 260),
      plannerMemo: '-',
      plannerStatus: '-',
      focusIssues: '-',
      alertCount: 0,
      reportStatus: weekly.final_weekly_comment ? '위클리 최종저장' : '위클리 저장',
      reportId: weekly.id,
      eventSummary: '-',
      details: { weeklyReport: weekly },
    });
  }

  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function buildSummary({ sessions = [], events = [], checks = [], reports = [], planners = [], acknowledgements = [], attendanceNotifications = [], parentNotifications = [], weeklyReports = [], scheduleConfig }) {
  const attendanceDays = sessions.filter((s) => s.check_in_at || s.seat_status !== 'absent').length;
  const absentDays = sessions.filter((s) => s.seat_status === 'absent').length;
  const totalStudyMinutes = sessions.reduce((sum, session) => {
    const sessionEvents = events.filter((event) => event.session_id === session.id);
    const daySchedule = resolveScheduleForDate(scheduleConfig, session.session_date);
    return sum + calculateScheduledPureStudyMinutes(session, { events: sessionEvents, studyWindows: daySchedule?.studyWindows });
  }, 0);
  const awayCount = events.filter((event) => event.event_type === 'away').length;
  const returnCount = events.filter((event) => event.event_type === 'return').length;
  const checkInCount = events.filter((event) => event.event_type === 'check_in').length;
  const checkOutCount = events.filter((event) => event.event_type === 'check_out').length;
  const lowSignalChecks = checks.filter((check) => ['수면', '비학습'].includes(check.study_status) || /졸|수면|비학습|휴대폰|딴짓|잡담/.test(String(check.study_content || check.mentor_memo || ''))).length;
  const studySummary = summarizeStudyChecks(checks);

  return {
    attendanceDays,
    absentDays,
    totalStudyMinutes,
    totalStudyLabel: formatMinutes(totalStudyMinutes),
    averageStudyMinutes: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    averageStudyLabel: formatMinutes(attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0),
    awayCount,
    returnCount,
    checkInCount,
    checkOutCount,
    studyCheckCount: checks.length,
    topSubject: studySummary.topSubject,
    topStudyStatus: studySummary.topStatus,
    plannerSubmitted: planners.length,
    focusCount: acknowledgements.length,
    lowSignalChecks,
    dailyReportCount: reports.length,
    dailySentCount: reports.filter((report) => report.sent_at).length,
    weeklyReportCount: weeklyReports.length,
    alertCount: attendanceNotifications.length + parentNotifications.length,
  };
}

function buildCounselingSource({ student, start, end, summary, rows }) {
  const studyVolumeGuide = classifyWeeklyStudyVolume(summary?.totalStudyMinutes || 0, start, end);
  return {
    student: {
      name: student?.name || '',
      school: student?.school || '',
      grade: student?.grade || '',
    },
    range: { start, end },
    summary: {
      ...summary,
      studyVolumeGuide,
    },
    studyVolumeGuide,
    dailyRows: (rows || [])
      .filter((row) => row.kind !== 'weekly')
      .slice(0, 31)
      .map((row) => ({
        date: row.date,
        attendance: row.attendanceSummary,
        pureStudy: row.pureStudyLabel,
        study: row.periodSummary,
        observation: row.observation,
        planner: row.plannerMemo,
        focus: row.focusIssues,
        report: row.reportStatus,
      })),
  };
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
    const studentId = searchParams.get('studentId');

    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });

    const warnings = [];
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id,name,school,grade,status,default_seat_no')
      .eq('id', studentId)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student) return Response.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

    const { data: sessions, error: sessionsError } = await supabase
      .from('daily_sessions')
      .select('*, students(id,name,school,grade)')
      .eq('student_id', studentId)
      .gte('session_date', start)
      .lte('session_date', end)
      .order('session_date', { ascending: false });
    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions || []).map((session) => session.id).filter(Boolean);
    let events = [];
    let checks = [];
    let reports = [];

    if (sessionIds.length) {
      const eventResult = await safeSelect('출결 이벤트', () => supabase
        .from('attendance_events')
        .select('*')
        .in('session_id', sessionIds)
        .order('event_at', { ascending: true }));
      events = eventResult.rows;
      if (eventResult.warning) warnings.push(eventResult.warning);

      const checkResult = await safeSelect('순찰 체크', () => supabase
        .from('study_checks')
        .select('*')
        .in('session_id', sessionIds)
        .order('checked_at', { ascending: true }));
      checks = checkResult.rows;
      if (checkResult.warning) warnings.push(checkResult.warning);

      const reportResult = await safeSelect('데일리 리포트', () => supabase
        .from('daily_reports')
        .select('*')
        .in('session_id', sessionIds));
      reports = reportResult.rows;
      if (reportResult.warning) warnings.push(reportResult.warning);
    }

    const plannerResult = await safeSelect('플래너', () => supabase
      .from('planner_photos')
      .select('*')
      .eq('student_id', studentId)
      .gte('planner_date', start)
      .lte('planner_date', end)
      .order('planner_date', { ascending: false }));
    const planners = plannerResult.rows;
    if (plannerResult.warning) warnings.push(plannerResult.warning);

    const focusResult = await safeSelect('관리주의 이력', () => supabase
      .from('field_focus_acknowledgements')
      .select('*')
      .eq('student_id', studentId)
      .eq('is_active', true)
      .gte('ack_date', start)
      .lte('ack_date', end)
      .order('ack_date', { ascending: false }));
    const acknowledgements = focusResult.rows;
    if (focusResult.warning) warnings.push(focusResult.warning);

    const attendanceNotificationResult = await safeSelect('출결 알림', () => supabase
      .from('attendance_notification_logs')
      .select('*')
      .eq('student_id', studentId)
      .gte('created_at', makeIsoStart(start))
      .lte('created_at', makeIsoEnd(end))
      .order('created_at', { ascending: false }));
    const attendanceNotifications = attendanceNotificationResult.rows;
    if (attendanceNotificationResult.warning) warnings.push(attendanceNotificationResult.warning);

    const parentNotificationResult = await safeSelect('학부모 확인 요청', () => supabase
      .from('parent_notification_logs')
      .select('*')
      .eq('student_id', studentId)
      .gte('created_at', makeIsoStart(start))
      .lte('created_at', makeIsoEnd(end))
      .order('created_at', { ascending: false }));
    const parentNotifications = parentNotificationResult.rows;
    if (parentNotificationResult.warning) warnings.push(parentNotificationResult.warning);

    const weeklyResult = await safeSelect('위클리 리포트', () => supabase
      .from('weekly_reports')
      .select('*')
      .eq('student_id', studentId)
      .lte('start_date', end)
      .gte('end_date', start)
      .order('start_date', { ascending: false }));
    const weeklyReports = weeklyResult.rows;
    if (weeklyResult.warning) warnings.push(weeklyResult.warning);

    const summaryResult = await safeSelect('상담 요약', () => supabase
      .from('student_counseling_summaries')
      .select('*')
      .eq('student_id', studentId)
      .eq('start_date', start)
      .eq('end_date', end)
      .order('updated_at', { ascending: false }));
    const counselingSummaries = summaryResult.rows;
    if (summaryResult.warning && !summaryResult.warning.includes('does not exist')) warnings.push(summaryResult.warning);
    const counselingSummariesByType = {};
    for (const item of counselingSummaries || []) {
      if (!counselingSummariesByType[item.summary_type]) counselingSummariesByType[item.summary_type] = item;
    }

    const reportsBySession = {};
    for (const report of reports || []) reportsBySession[report.session_id] = report;
    const plannersByDate = {};
    for (const planner of planners || []) plannersByDate[planner.planner_date] = planner;
    const eventsBySession = byKey(events, 'session_id');
    const checksBySession = byKey(checks, 'session_id');
    const acksByDate = byKey(acknowledgements, 'ack_date');
    const attendanceNotificationsByDate = {};
    for (const log of attendanceNotifications || []) {
      const date = String(log.event_at || log.created_at || '').slice(0, 10);
      if (!attendanceNotificationsByDate[date]) attendanceNotificationsByDate[date] = [];
      attendanceNotificationsByDate[date].push(log);
    }
    const parentNotificationsByDate = {};
    for (const log of parentNotifications || []) {
      const date = String(log.created_at || '').slice(0, 10);
      if (!parentNotificationsByDate[date]) parentNotificationsByDate[date] = [];
      parentNotificationsByDate[date].push(log);
    }

    const rows = getTimelineRows({
      sessions: sessions || [],
      eventsBySession,
      checksBySession,
      reportsBySession,
      plannersByDate,
      acksByDate,
      attendanceNotificationsByDate,
      parentNotificationsByDate,
      weeklyReports,
      scheduleConfig,
    });

    const summary = buildSummary({
      sessions: sessions || [],
      events,
      checks,
      reports,
      planners,
      acknowledgements,
      attendanceNotifications,
      parentNotifications,
      weeklyReports,
      scheduleConfig,
    });
    summary.studyVolumeGuide = classifyWeeklyStudyVolume(summary.totalStudyMinutes || 0, start, end);

    return Response.json({
      ok: true,
      student,
      start,
      end,
      summary,
      rows,
      raw: {
        sessions,
        events,
        checks,
        reports,
        planners,
        acknowledgements,
        attendanceNotifications,
        parentNotifications,
        weeklyReports,
      },
      counselingSummary: counselingSummaries?.[0] || null,
      counselingSummaries,
      counselingSummariesByType,
      counselingSource: buildCounselingSource({ student, start, end, summary, rows }),
      aiConfig: {
        openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.GPT_SUMMARY_MODEL || process.env.STUDENT_SUMMARY_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      },
      warnings,
    });
  } catch (error) {
    return Response.json({ error: error.message || '학생 관리 이력 조회 실패' }, { status: 500 });
  }
}
