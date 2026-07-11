import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : getKstDateString();
}

async function loadPayload(supabase, date) {
  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('*, student_guardians(*)')
    .eq('status', 'active')
    .order('name', { ascending: true });

  if (studentsError) throw studentsError;

  const { data: sessions, error: sessionsError } = await supabase
    .from('daily_sessions')
    .select('*, students(*, student_guardians(*))')
    .eq('session_date', date)
    .order('seat_no', { ascending: true });

  if (sessionsError) throw sessionsError;

  let schedules = [];
  try {
    const { data: scheduleRows, error: scheduleError } = await supabase
      .from('student_daily_schedules')
      .select('*')
      .eq('schedule_date', date);
    if (!scheduleError) schedules = scheduleRows || [];
  } catch {
    schedules = [];
  }

  const sessionIds = (sessions || []).map((session) => session.id);
  let checks = [];
  let events = [];
  let reports = [];

  if (sessionIds.length) {
    const { data: checkRows, error: checksError } = await supabase
      .from('study_checks')
      .select('*')
      .in('session_id', sessionIds)
      .order('checked_at', { ascending: false });
    if (!checksError) checks = checkRows || [];

    const { data: eventRows, error: eventsError } = await supabase
      .from('attendance_events')
      .select('*')
      .in('session_id', sessionIds)
      .order('event_at', { ascending: false });
    if (!eventsError) events = eventRows || [];

    const { data: reportRows, error: reportsError } = await supabase
      .from('daily_reports')
      .select('*')
      .in('session_id', sessionIds);
    if (!reportsError) reports = reportRows || [];
  }

  const sessionByStudent = {};
  for (const session of sessions || []) sessionByStudent[session.student_id] = session;

  const scheduleByStudent = {};
  for (const schedule of schedules || []) scheduleByStudent[schedule.student_id] = schedule;

  const targetSessions = [];
  for (const student of students || []) {
    const existing = sessionByStudent[student.id];
    if (existing) {
      targetSessions.push({ ...existing, is_virtual: false, report_target_reason: 'session' });
      continue;
    }

    const schedule = scheduleByStudent[student.id] || null;
    targetSessions.push({
      id: `virtual-${student.id}-${date}`,
      student_id: student.id,
      seat_no: Number(schedule?.seat_no || student.default_seat_no || 0),
      session_date: date,
      seat_status: 'not_arrived',
      check_in_at: null,
      check_out_at: null,
      away_started_at: null,
      away_total_minutes: 0,
      pure_study_minutes: 0,
      current_study_status: null,
      current_subject: null,
      attendance_memo: null,
      students: student,
      is_virtual: true,
      report_target_reason: schedule ? 'schedule' : 'active_student',
    });
  }

  targetSessions.sort((a, b) => {
    const seatA = Number(a.seat_no || 999);
    const seatB = Number(b.seat_no || 999);
    if (seatA !== seatB) return seatA - seatB;
    return String(a.students?.name || '').localeCompare(String(b.students?.name || ''), 'ko');
  });

  return {
    date,
    students: students || [],
    schedules,
    sessions: targetSessions,
    actualSessions: sessions || [],
    checks,
    events,
    reports,
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const date = toDate(searchParams.get('date'));
    const payload = await loadPayload(supabase, date);
    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const date = toDate(body.date);
    const studentId = String(body.studentId || '');

    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student) return Response.json({ error: '존재하지 않는 학생입니다.' }, { status: 404 });

    const { data: existing, error: existingError } = await supabase
      .from('daily_sessions')
      .select('*, students(*, student_guardians(*))')
      .eq('student_id', studentId)
      .eq('session_date', date)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return Response.json({ session: existing, created: false });

    let schedule = null;
    try {
      const { data: scheduleRow } = await supabase
        .from('student_daily_schedules')
        .select('*')
        .eq('student_id', studentId)
        .eq('schedule_date', date)
        .maybeSingle();
      schedule = scheduleRow || null;
    } catch {
      schedule = null;
    }

    const seatNo = Number(schedule?.seat_no || student.default_seat_no || 0);
    if (!seatNo) {
      return Response.json({ error: '학생의 기본 좌석 또는 해당일 시간표 좌석이 필요합니다.' }, { status: 400 });
    }

    const { data: created, error: createError } = await supabase
      .from('daily_sessions')
      .insert({
        student_id: studentId,
        seat_no: seatNo,
        session_date: date,
        seat_status: 'not_arrived',
        check_in_at: null,
        check_out_at: null,
        away_total_minutes: 0,
        pure_study_minutes: 0,
        current_study_status: null,
        current_subject: null,
      })
      .select('*, students(*, student_guardians(*))')
      .single();

    if (createError) throw createError;

    return Response.json({ session: created, created: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
