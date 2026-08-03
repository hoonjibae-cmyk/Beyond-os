// Beyond OS v41-136
// 학생 한 명의 "한눈에 보기" 종합 카드용 API입니다.
// 학생 관리 / 학습 관리 / 리포트 탭을 오가지 않아도 코칭 직전에 필요한 정보를 한 번에 내려줍니다.
//   - 기본 정보와 담당 코치
//   - 전체 누적 순공시간 / 등원일수 (daily_sessions.pure_study_minutes 기준)
//   - 최근 주차별 학습량 추이
//   - 상벌점 누계와 최근 내역
//   - 데일리 코칭(멘토 코멘트) / 위클리 상담(주간 면담) 이력
//   - 최근 차시별 학습 기록(순찰 체크)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes, formatMinutes } from '../../../lib/date';

export const dynamic = 'force-dynamic';

const RECENT_DAYS_DEFAULT = 90;
const RECENT_WEEK_COUNT = 8;

const DEFAULT_RULES = {
  lowStudyMinutes: 300,
  lateThresholdMinutes: 1,
  earlyLeaveThresholdMinutes: 10,
  excessiveAwayCount: 2,
  excessiveAwayMinutes: 60,
};

function addDays(dateString, amount) {
  const base = new Date(`${dateString}T12:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + amount);
  return base.toISOString().slice(0, 10);
}

function getKstDayOfWeek(dateString) {
  return new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
}

// 월요일 시작 주의 시작일을 반환합니다.
function startOfWeek(dateString) {
  const day = getKstDayOfWeek(dateString);
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(dateString, offset);
}

function formatKstTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
  } catch {
    return '';
  }
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function safeText(value, limit = 400) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// 테이블/컬럼이 아직 없는 환경에서도 나머지 정보는 그대로 보여줍니다.
async function safeSelect(label, runner) {
  try {
    const { data, error } = await runner();
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    return { rows: [], warning: `${label} 조회 실패: ${error?.message || error}` };
  }
}

async function loadOperatingRules(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'operating_rules')
      .maybeSingle();
    if (error) throw error;
    return { ...DEFAULT_RULES, ...(data?.setting_value || {}) };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

// 담당 코치(멘토별 담당학생 설정)를 찾습니다. v41-31.4 SQL 미실행 환경에서는 null을 반환합니다.
async function loadAssignedMentor(supabase, studentId) {
  try {
    const { data, error } = await supabase
      .from('mentoring_mentor_students')
      .select('id, note, mentoring_mentors(id, mentor_name)')
      .eq('student_id', studentId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.mentoring_mentors) return { mentor: null, warning: '' };
    return {
      mentor: {
        id: data.mentoring_mentors.id,
        name: data.mentoring_mentors.mentor_name || '',
        note: data.note || '',
      },
      warning: '',
    };
  } catch (error) {
    return {
      mentor: null,
      warning: `담당 코치 정보를 읽지 못했습니다(${error?.message || error}). beyond-os-supabase-mentoring-mentor-students-v41-31-4.sql 실행 여부를 확인하세요.`,
    };
  }
}

function getSessionAwayMinutes(session = {}, nowIso) {
  return Math.max(
    0,
    Number(session.away_total_minutes || 0)
      + (session.away_started_at ? diffMinutes(session.away_started_at, session.check_out_at || nowIso) : 0)
  );
}

function buildRecentWeeks(sessions = [], today) {
  const weeks = [];
  const thisWeekStart = startOfWeek(today);
  for (let index = RECENT_WEEK_COUNT - 1; index >= 0; index -= 1) {
    const start = addDays(thisWeekStart, -7 * index);
    const end = addDays(start, 6);
    weeks.push({ start, end, attendDays: 0, studyMinutes: 0 });
  }

  for (const session of sessions) {
    const date = String(session.session_date || '');
    const week = weeks.find((item) => date >= item.start && date <= item.end);
    if (!week) continue;
    if (session.check_in_at) week.attendDays += 1;
    week.studyMinutes += Math.max(0, Number(session.pure_study_minutes || 0));
  }

  return weeks.map((week) => ({
    ...week,
    label: `${week.start.slice(5).replace('-', '/')}~${week.end.slice(5).replace('-', '/')}`,
    studyLabel: formatMinutes(week.studyMinutes),
    isCurrent: week.start === thisWeekStart,
  }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = String(searchParams.get('studentId') || '').trim();
    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });

    const today = getKstDateString();
    const nowIso = new Date().toISOString();
    const recentDaysRaw = Number(searchParams.get('days') || RECENT_DAYS_DEFAULT);
    const recentDays = Number.isFinite(recentDaysRaw) ? Math.min(365, Math.max(14, Math.round(recentDaysRaw))) : RECENT_DAYS_DEFAULT;
    const recentStart = addDays(today, -(recentDays - 1));

    const warnings = [];

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('id', studentId)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student) return Response.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

    const rules = await loadOperatingRules(supabase);
    const { mentor: assignedMentor, warning: mentorWarning } = await loadAssignedMentor(supabase, studentId);
    if (mentorWarning) warnings.push(mentorWarning);

    // 전체 누적 집계는 저장된 pure_study_minutes를 사용해 가볍게 계산합니다.
    const allSessionsResult = await safeSelect('출결 세션', () => supabase
      .from('daily_sessions')
      .select('id,session_date,check_in_at,check_out_at,seat_status,pure_study_minutes,away_total_minutes,away_started_at')
      .eq('student_id', studentId)
      .order('session_date', { ascending: false }));
    if (allSessionsResult.warning) warnings.push(allSessionsResult.warning);
    const allSessions = allSessionsResult.rows;

    const attendedSessions = allSessions.filter((session) => session.check_in_at);
    const totalStudyMinutes = allSessions.reduce((sum, session) => sum + Math.max(0, Number(session.pure_study_minutes || 0)), 0);
    const studyDays = allSessions.filter((session) => Number(session.pure_study_minutes || 0) > 0);
    const bestSession = studyDays.reduce(
      (best, session) => (Number(session.pure_study_minutes || 0) > Number(best?.pure_study_minutes || 0) ? session : best),
      null,
    );
    const dates = allSessions.map((session) => String(session.session_date || '')).filter(Boolean).sort();

    const recentSessions = allSessions.filter((session) => String(session.session_date || '') >= recentStart);
    const recentSessionIds = recentSessions.map((session) => session.id).filter(Boolean);

    // 최근 구간의 지각/조퇴 판정을 위해 개인 시간표를 함께 읽습니다.
    const scheduleResult = await safeSelect('개인 시간표', () => supabase
      .from('student_daily_schedules')
      .select('schedule_date,planned_check_in,planned_check_out')
      .eq('student_id', studentId)
      .gte('schedule_date', recentStart)
      .lte('schedule_date', today));
    if (scheduleResult.warning) warnings.push(scheduleResult.warning);
    const scheduleByDate = {};
    for (const row of scheduleResult.rows) scheduleByDate[row.schedule_date] = row;

    let flags = { lateDays: 0, earlyLeaveDays: 0, absentDays: 0, awayCount: 0, awayMinutes: 0, lowStudyDays: 0, attendDays: 0 };
    for (const session of recentSessions) {
      const awayMinutes = getSessionAwayMinutes(session, nowIso);
      flags.awayMinutes += awayMinutes;
      if (session.seat_status === 'absent') flags.absentDays += 1;
      if (session.check_in_at) flags.attendDays += 1;

      const schedule = scheduleByDate[session.session_date] || {};
      const plannedIn = timeToMinutes(schedule.planned_check_in);
      const plannedOut = timeToMinutes(schedule.planned_check_out);
      const actualIn = timeToMinutes(formatKstTime(session.check_in_at));
      const actualOut = timeToMinutes(formatKstTime(session.check_out_at));
      if (plannedIn !== null && actualIn !== null && actualIn - plannedIn >= rules.lateThresholdMinutes) flags.lateDays += 1;
      if (plannedOut !== null && actualOut !== null && plannedOut - actualOut >= rules.earlyLeaveThresholdMinutes) flags.earlyLeaveDays += 1;

      const pure = Number(session.pure_study_minutes || 0);
      if (session.check_in_at && pure > 0 && pure < rules.lowStudyMinutes) flags.lowStudyDays += 1;
    }

    // 최근 구간 외출 횟수는 이벤트 기준으로 셉니다.
    let studyChecks = [];
    let dailyReports = [];
    if (recentSessionIds.length) {
      const awayEventResult = await safeSelect('외출 이벤트', () => supabase
        .from('attendance_events')
        .select('session_id,event_type')
        .in('session_id', recentSessionIds)
        .eq('event_type', 'away'));
      if (awayEventResult.warning) warnings.push(awayEventResult.warning);
      flags.awayCount = awayEventResult.rows.length;

      const checkResult = await safeSelect('차시별 학습 기록', () => supabase
        .from('study_checks')
        .select('session_id,subject,study_status,study_content,checked_at,created_at')
        .in('session_id', recentSessionIds)
        .order('checked_at', { ascending: false })
        .limit(400));
      if (checkResult.warning) warnings.push(checkResult.warning);
      studyChecks = checkResult.rows;

      // mentor_comment_by / mentor_comment_at 컬럼은 v41-129 SQL 실행 이후에만 존재하므로
      // 컬럼을 지정하지 않고 전체를 읽어 없는 환경에서도 코칭 이력이 비지 않도록 합니다.
      const reportResult = await safeSelect('데일리 리포트', () => supabase
        .from('daily_reports')
        .select('*')
        .in('session_id', recentSessionIds));
      if (reportResult.warning) warnings.push(reportResult.warning);
      dailyReports = reportResult.rows;
    }

    const sessionDateById = {};
    for (const session of recentSessions) sessionDateById[session.id] = session.session_date;

    // 데일리 코칭(멘토 코멘트) 이력
    const dailyCoaching = dailyReports
      .filter((report) => String(report.mentor_comment || '').trim())
      .map((report) => ({
        date: sessionDateById[report.session_id] || '',
        comment: String(report.mentor_comment || '').trim(),
        by: report.mentor_comment_by || report.created_by || '',
        at: report.mentor_comment_at || '',
      }))
      .filter((item) => item.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // 차시별 학습 기록을 날짜별로 묶습니다.
    const studyLogByDate = new Map();
    for (const check of studyChecks) {
      const date = sessionDateById[check.session_id];
      if (!date) continue;
      if (!studyLogByDate.has(date)) studyLogByDate.set(date, []);
      studyLogByDate.get(date).push({
        time: formatKstTime(check.checked_at || check.created_at),
        subject: check.subject || '-',
        status: check.study_status || '-',
        content: safeText(check.study_content || '', 80),
      });
    }
    const studyLog = [...studyLogByDate.entries()]
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .map(([date, lines]) => ({
        date,
        lines: lines.sort((a, b) => String(a.time).localeCompare(String(b.time))),
      }));

    // 위클리 상담(주간 면담) 이력
    const weeklyResult = await safeSelect('위클리 리포트', () => supabase
      .from('weekly_reports')
      .select('id,start_date,end_date,director_interview,final_weekly_comment,ai_weekly_comment,send_status,sent_at,summary_payload')
      .eq('student_id', studentId)
      .order('start_date', { ascending: false })
      .limit(12));
    if (weeklyResult.warning) warnings.push(weeklyResult.warning);
    const weeklyCoaching = weeklyResult.rows.map((row) => ({
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      interview: String(row.director_interview || '').trim(),
      finalComment: String(row.final_weekly_comment || row.ai_weekly_comment || '').trim(),
      sentAt: row.sent_at || '',
      sendStatus: row.send_status || '',
      studyMinutes: Number(row.summary_payload?.totalStudyMinutes || row.summary_payload?.totalStudy || 0),
    }));

    // 상벌점 (전체 누계 + 최근 내역)
    const pointsResult = await safeSelect('상벌점', () => supabase
      .from('student_points')
      .select('id,point_date,point_type,points,reason,memo,created_by')
      .eq('student_id', studentId)
      .eq('is_deleted', false)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200));
    if (pointsResult.warning) warnings.push(pointsResult.warning);
    const pointRows = pointsResult.rows;
    const reward = pointRows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
    const penalty = pointRows.filter((row) => row.point_type !== 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);

    const dailySentCount = dailyReports.filter((report) => report.sent_at).length;

    return Response.json({
      ok: true,
      today,
      recentStart,
      recentDays,
      student,
      assignedMentor,
      rules,
      totals: {
        firstSessionDate: dates[0] || '',
        lastSessionDate: dates[dates.length - 1] || '',
        sessionCount: allSessions.length,
        attendDays: attendedSessions.length,
        absentDays: allSessions.filter((session) => session.seat_status === 'absent').length,
        totalStudyMinutes,
        totalStudyLabel: formatMinutes(totalStudyMinutes),
        avgStudyMinutes: studyDays.length ? Math.round(totalStudyMinutes / studyDays.length) : 0,
        avgStudyLabel: formatMinutes(studyDays.length ? Math.round(totalStudyMinutes / studyDays.length) : 0),
        bestStudyMinutes: Number(bestSession?.pure_study_minutes || 0),
        bestStudyLabel: formatMinutes(Number(bestSession?.pure_study_minutes || 0)),
        bestStudyDate: bestSession?.session_date || '',
        studyCheckCount: studyChecks.length,
        dailyCommentCount: dailyCoaching.length,
        dailySentCount,
        weeklyReportCount: weeklyCoaching.length,
      },
      recentWeeks: buildRecentWeeks(allSessions, today),
      flags,
      points: {
        reward,
        penalty,
        net: reward - penalty,
        count: pointRows.length,
        rows: pointRows.slice(0, 10),
      },
      dailyCoaching: dailyCoaching.slice(0, 10),
      weeklyCoaching,
      studyLog: studyLog.slice(0, 5),
      warnings,
    });
  } catch (error) {
    return Response.json({ error: error.message || '학생 종합 정보 조회 실패' }, { status: 500 });
  }
}
