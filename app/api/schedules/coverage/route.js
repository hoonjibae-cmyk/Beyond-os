import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { getKstDateString } from '../../../../lib/date';

export const dynamic = 'force-dynamic';

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

// 활성 학생별 개인 시간표 보유 현황을 반환합니다.
// v41-42부터 개인 시간표가 없는 날은 등원 예정이 없으므로(결석 감지 제외),
// 시간표가 아예 없거나 곧 만료되는 학생을 조기에 경고하기 위한 용도입니다.
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const warnDays = Math.max(1, Math.min(30, Number(searchParams.get('warnDays') || 7)));
    const warnUntil = addDays(today, warnDays);

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id,name,status')
      .order('name', { ascending: true });
    if (studentsError) throw studentsError;

    const activeStudents = (students || []).filter((student) => student.status !== 'inactive');
    if (!activeStudents.length) {
      return Response.json({ today, warnDays, warnings: [], activeStudentCount: 0 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from('student_daily_schedules')
      .select('student_id,schedule_date')
      .gte('schedule_date', today)
      .in('student_id', activeStudents.map((student) => student.id));
    if (rowsError) throw rowsError;

    const lastDateByStudent = {};
    for (const row of rows || []) {
      const current = lastDateByStudent[row.student_id];
      if (!current || row.schedule_date > current) lastDateByStudent[row.student_id] = row.schedule_date;
    }

    const warnings = activeStudents
      .map((student) => {
        const lastDate = lastDateByStudent[student.id] || null;
        if (!lastDate) return { studentId: student.id, name: student.name, lastDate: null, kind: 'missing' };
        if (lastDate <= warnUntil) return { studentId: student.id, name: student.name, lastDate, kind: 'expiring' };
        return null;
      })
      .filter(Boolean);

    return Response.json({ today, warnDays, warnings, activeStudentCount: activeStudents.length });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
