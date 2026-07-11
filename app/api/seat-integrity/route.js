import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

function toSeatNo(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 26 ? n : null;
}

function summarizeStudent(student) {
  if (!student) return '알 수 없는 학생';
  return `${student.name || '이름 없음'}${student.school || student.grade ? ` (${[student.school, student.grade].filter(Boolean).join(' ')})` : ''}`;
}

function buildDiagnostics({ seats, students, sessions, today }) {
  const activeStudents = (students || []).filter((student) => student.status !== 'inactive');
  const studentById = {};
  for (const student of students || []) studentById[student.id] = student;

  const defaultBySeat = {};
  const duplicateDefaultSeats = {};

  for (const student of activeStudents) {
    const seatNo = toSeatNo(student.default_seat_no);
    if (!seatNo) continue;
    if (defaultBySeat[seatNo]) {
      duplicateDefaultSeats[seatNo] = [...(duplicateDefaultSeats[seatNo] || [defaultBySeat[seatNo]]), student];
    } else {
      defaultBySeat[seatNo] = student;
    }
  }

  const issues = [];
  const currentSeatsByStudent = {};
  for (const seat of seats || []) {
    if (!seat.current_student_id) continue;
    if (!currentSeatsByStudent[seat.current_student_id]) currentSeatsByStudent[seat.current_student_id] = [];
    currentSeatsByStudent[seat.current_student_id].push(Number(seat.seat_no));
  }

  for (const [studentId, seatNos] of Object.entries(currentSeatsByStudent)) {
    if (seatNos.length > 1) {
      issues.push({
        type: 'duplicate_current_student',
        severity: 'high',
        category: 'auto',
        title: '한 학생이 여러 좌석에 연결됨',
        detail: `${summarizeStudent(studentById[studentId])}: ${seatNos.map((n) => `${n}번`).join(', ')}`,
      });
    }
  }

  for (const [seatNo, duplicates] of Object.entries(duplicateDefaultSeats)) {
    issues.push({
      type: 'duplicate_default_seat',
      severity: 'high',
      category: 'review',
      title: '한 좌석이 여러 학생의 기본 좌석으로 지정됨',
      detail: `${seatNo}번 좌석: ${duplicates.map(summarizeStudent).join(', ')}`,
    });
  }

  for (const seat of seats || []) {
    const seatNo = Number(seat.seat_no);
    const currentStudent = seat.current_student_id ? studentById[seat.current_student_id] : null;
    const expectedStudent = defaultBySeat[seatNo] || null;

    if (seat.current_student_id && !currentStudent) {
      issues.push({
        type: 'missing_current_student',
        severity: 'high',
        category: 'auto',
        title: '좌석에 존재하지 않는 학생 ID가 남아 있음',
        detail: `${seatNo}번 좌석: ${seat.current_student_id}`,
      });
    }

    if (currentStudent && expectedStudent && currentStudent.id !== expectedStudent.id) {
      issues.push({
        type: 'seat_mismatch',
        severity: 'high',
        category: 'auto',
        title: '좌석 배정값이 학생 기본 좌석과 다름',
        detail: `${seatNo}번 좌석: 현재 ${summarizeStudent(currentStudent)} / 기준 ${summarizeStudent(expectedStudent)}`,
      });
    }

    if (currentStudent && !expectedStudent && toSeatNo(currentStudent.default_seat_no) !== seatNo) {
      issues.push({
        type: 'orphan_current_student',
        severity: 'medium',
        category: 'auto',
        title: '미배정이어야 할 좌석에 학생 연결값이 남아 있음',
        detail: `${seatNo}번 좌석: ${summarizeStudent(currentStudent)}`,
      });
    }

    if (!currentStudent && expectedStudent) {
      issues.push({
        type: 'missing_seat_current_student',
        severity: 'medium',
        category: 'auto',
        title: '학생 기본 좌석에는 배정되어 있으나 좌석 테이블이 비어 있음',
        detail: `${seatNo}번 좌석: ${summarizeStudent(expectedStudent)}`,
      });
    }
  }

  for (const session of sessions || []) {
    const student = session.students || studentById[session.student_id];
    const defaultSeatNo = toSeatNo(student?.default_seat_no);
    if (defaultSeatNo && Number(session.seat_no) !== defaultSeatNo && ['occupied', 'away', 'needs_attention'].includes(session.seat_status)) {
      issues.push({
        type: 'session_seat_mismatch',
        severity: 'medium',
        category: 'review',
        title: '오늘 세션 좌석과 학생 기본 좌석이 다름',
        detail: `${summarizeStudent(student)}: 오늘 ${session.seat_no}번 / 기본 ${defaultSeatNo}번`,
      });
    }
  }

  const cleanupPlan = [];
  for (const seat of seats || []) {
    const seatNo = Number(seat.seat_no);
    const expectedStudent = defaultBySeat[seatNo] || null;
    const expectedId = expectedStudent?.id || null;
    const currentId = seat.current_student_id || null;
    if (currentId !== expectedId) {
      cleanupPlan.push({
        kind: 'seat',
        seatNo,
        beforeStudentId: currentId,
        beforeStudentName: currentId ? studentById[currentId]?.name || currentId : '미배정',
        afterStudentId: expectedId,
        afterStudentName: expectedStudent?.name || '미배정',
      });
    }
  }

  return {
    today,
    checkedAt: new Date().toISOString(),
    summary: {
      seatCount: (seats || []).length,
      studentCount: activeStudents.length,
      issueCount: issues.length,
      cleanupCount: cleanupPlan.length,
      reviewCount: issues.filter((issue) => issue.category === 'review').length,
      highCount: issues.filter((issue) => issue.severity === 'high').length,
      mediumCount: issues.filter((issue) => issue.severity === 'medium').length,
    },
    issues,
    cleanupPlan,
  };
}

async function loadData(supabase) {
  const today = getKstDateString();

  const { data: seats, error: seatsError } = await supabase
    .from('seats')
    .select('*')
    .eq('is_active', true)
    .order('seat_no', { ascending: true });
  if (seatsError) throw seatsError;

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('*')
    .order('name', { ascending: true });
  if (studentsError) throw studentsError;

  const { data: sessions, error: sessionsError } = await supabase
    .from('daily_sessions')
    .select('*, students(*)')
    .eq('session_date', today);
  if (sessionsError) throw sessionsError;

  return { seats: seats || [], students: students || [], sessions: sessions || [], today };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const data = await loadData(supabase);
    return Response.json(buildDiagnostics(data));
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'cleanup';
    if (action !== 'cleanup') {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await loadData(supabase);
    const diagnostics = buildDiagnostics(loaded);

    for (const item of diagnostics.cleanupPlan || []) {
      if (item.kind !== 'seat') continue;
      const { error } = await supabase
        .from('seats')
        .update({ current_student_id: item.afterStudentId || null })
        .eq('seat_no', item.seatNo);
      if (error) throw error;
    }

    const refreshed = await loadData(supabase);
    return Response.json({
      ok: true,
      appliedCount: (diagnostics.cleanupPlan || []).filter((item) => item.kind === 'seat').length,
      before: diagnostics,
      after: buildDiagnostics(refreshed),
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
