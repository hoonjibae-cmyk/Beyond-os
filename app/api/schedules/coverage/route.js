import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { getKstDateString } from '../../../../lib/date';
import { loadScheduleCohortContext, getCohortForDate } from '../../../../lib/scheduleCohort';

export const dynamic = 'force-dynamic';

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

// 개인 시간표 보유 현황을 반환합니다.
// 개인 시간표가 없는 날은 등원 예정이 없어 결석 감지가 되지 않으므로,
// 시간표가 아예 없거나 곧 만료되는 학생을 미리 경고하기 위한 용도입니다.
//
// v41-192: 경고 대상을 기수 명단으로 좁힙니다.
//   경고의 목적은 '지금 다니는 학생인데 시간표가 비어 있다'를 알리는 것입니다.
//   지난 기수만 다니고 나간 학생은 앞으로 등원하지 않으므로 경고할 이유가 없는데,
//   지금까지는 활성 학생 전원을 대상으로 해서 1기만 수강한 학생까지 줄줄이 떴습니다.
//   기수를 하나도 만들지 않은 환경에서는 예전처럼 활성 학생 전원을 봅니다.
export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const warnDays = Math.max(1, Math.min(30, Number(searchParams.get('warnDays') || 7)));
    const warnUntil = addDays(today, warnDays);

    const requestedCohortId = String(
      searchParams.get('cohortId') || request.headers.get('x-beyond-cohort-id') || '',
    ).trim();

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id,name,status')
      .order('name', { ascending: true });
    if (studentsError) throw studentsError;

    let activeStudents = (students || []).filter((student) => student.status !== 'inactive');

    // 대상 기수: 화면에서 고른 기수 → 오늘이 속한 기수 → 가장 최근 기수
    const context = await loadScheduleCohortContext(supabase);
    let cohort = null;
    if (context.enabled) {
      cohort = requestedCohortId
        ? context.cohorts.find((item) => String(item.id) === requestedCohortId) || null
        : null;
      if (!cohort) cohort = getCohortForDate(context, today);
      if (!cohort) cohort = context.cohorts[context.cohorts.length - 1] || null;
    }

    // 이미 끝난 기수를 보고 있으면 앞으로의 시간표가 없는 것이 정상입니다.
    if (cohort && cohort.endDate < today) {
      return Response.json({
        today,
        warnDays,
        warnings: [],
        activeStudentCount: 0,
        cohortId: cohort.id,
        cohortName: cohort.name,
        skippedReason: 'cohort_ended',
      });
    }

    let rosterSize = 0;
    if (cohort) {
      const { data: rosterRows, error: rosterError } = await supabase
        .from('cohort_students')
        .select('student_id')
        .eq('cohort_id', cohort.id)
        .eq('is_active', true);
      if (rosterError) throw rosterError;
      const roster = new Set((rosterRows || []).map((row) => String(row.student_id)));
      rosterSize = roster.size;
      // 명단을 아직 만들지 않은 기수라면 명단 조건을 적용하지 않습니다.
      if (roster.size) activeStudents = activeStudents.filter((student) => roster.has(String(student.id)));
    }

    if (!activeStudents.length) {
      return Response.json({
        today,
        warnDays,
        warnings: [],
        activeStudentCount: 0,
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
      });
    }

    // 아직 시작하지 않은 기수는 기수 시작일부터 봅니다.
    const from = cohort && cohort.startDate > today ? cohort.startDate : today;

    const { data: rows, error: rowsError } = await supabase
      .from('student_daily_schedules')
      .select('student_id,schedule_date')
      .gte('schedule_date', from)
      .in('student_id', activeStudents.map((student) => student.id));
    if (rowsError) throw rowsError;

    const lastDateByStudent = {};
    for (const row of rows || []) {
      const current = lastDateByStudent[row.student_id];
      if (!current || row.schedule_date > current) lastDateByStudent[row.student_id] = row.schedule_date;
    }

    // 만료 임박 기준일. 기수 종료일을 넘겨서 채우라고 재촉하지 않습니다.
    const expiringUntil = cohort && cohort.endDate < warnUntil ? cohort.endDate : warnUntil;

    const warnings = activeStudents
      .map((student) => {
        const lastDate = lastDateByStudent[student.id] || null;
        if (!lastDate) return { studentId: student.id, name: student.name, lastDate: null, kind: 'missing' };
        if (lastDate < expiringUntil) return { studentId: student.id, name: student.name, lastDate, kind: 'expiring' };
        return null;
      })
      .filter(Boolean);

    return Response.json({
      today,
      warnDays,
      warnings,
      activeStudentCount: activeStudents.length,
      cohortId: cohort?.id || null,
      cohortName: cohort?.name || '',
      cohortStartDate: cohort?.startDate || null,
      cohortEndDate: cohort?.endDate || null,
      rosterSize,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
