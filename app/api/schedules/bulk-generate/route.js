import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { writeUserActionLog } from '../../../../lib/actionLog';
import { getKstDateString } from '../../../../lib/date';
import { getDefaultScheduleConfig } from '../../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../../lib/defaultSchedule';
import { loadScheduleCohortContext, getCohortForDate, clampRangeToCohort } from '../../../../lib/scheduleCohort';

export const dynamic = 'force-dynamic';

const MAX_RANGE_DAYS = 92;
const INSERT_CHUNK_SIZE = 400;

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// 요일 유형별 기본 시간표를 템플릿으로, 기간 내 운영일에 학생 개인 시간표를 일괄 생성합니다.
// - 이미 개인 시간표가 저장된 (학생, 날짜)는 건드리지 않습니다. (보존)
// - 운영 토글이 꺼진 요일 유형(예: 일요일/공휴일)은 건너뜁니다.
export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const today = getKstDateString();

    let startDate = isValidDate(body.startDate) ? body.startDate : today;
    let endDate = isValidDate(body.endDate) ? body.endDate : addDays(startDate, 27);
    if (endDate < startDate) {
      return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });
    }

    // v41-185: 개인 시간표는 기수 하나만 채웁니다.
    // 요청 기간이 기수 경계를 넘으면 경계에서 자르고, 어느 기수에도 속하지 않는
    // 기간이면 아예 만들지 않습니다. (allowCrossCohort 로만 예외)
    const allowCrossCohort = body.allowCrossCohort === true;
    const cohortContext = await loadScheduleCohortContext(supabase);
    const requestedCohortId = String(body.cohortId || request.headers.get('x-beyond-cohort-id') || '').trim();
    let cohort = null;
    let clampedToCohort = false;

    if (cohortContext.enabled && !allowCrossCohort) {
      cohort = requestedCohortId
        ? cohortContext.cohorts.find((item) => String(item.id) === requestedCohortId) || null
        : null;
      // 기수를 지정하지 않았으면 시작일이 속한 기수를 씁니다.
      if (!cohort) cohort = getCohortForDate(cohortContext, startDate);
      if (!cohort) {
        return Response.json({
          error: `${startDate}은 어느 기수 기간에도 들어가지 않습니다.`
            + ' 개인 시간표는 기수 기간 안에만 만들 수 있습니다. 설정 · 기수 관리에서 기간을 확인하거나 시작일을 조정하세요.',
        }, { status: 400 });
      }

      const clamped = clampRangeToCohort(cohort, startDate, endDate);
      if (!clamped) {
        return Response.json({
          error: `요청한 기간(${startDate}~${endDate})이 ${cohort.name} 기간(${cohort.startDate}~${cohort.endDate})과 겹치지 않습니다.`,
        }, { status: 400 });
      }
      startDate = clamped.startDate;
      endDate = clamped.endDate;
      clampedToCohort = clamped.clamped;
    }

    const dates = [];
    let cursor = startDate;
    while (cursor <= endDate && dates.length <= MAX_RANGE_DAYS) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    if (dates.length > MAX_RANGE_DAYS) {
      return Response.json({ error: `일괄 생성 기간은 최대 ${MAX_RANGE_DAYS}일까지 가능합니다.` }, { status: 400 });
    }

    let studentQuery = supabase.from('students').select('id,name,status');
    const requestedIds = Array.isArray(body.studentIds) ? body.studentIds.map(String).filter(Boolean) : null;
    if (requestedIds && requestedIds.length) studentQuery = studentQuery.in('id', requestedIds);
    const { data: students, error: studentsError } = await studentQuery;
    if (studentsError) throw studentsError;

    let targetStudents = (students || []).filter((student) => student.status !== 'inactive');

    // v41-185: 그 기수 수강 명단에 있는 학생만 만듭니다.
    // 명단을 아직 만들지 않은 기수라면(0명) 명단 조건은 적용하지 않습니다.
    let skippedNotEnrolled = 0;
    if (cohort) {
      const { data: rosterRows, error: rosterError } = await supabase
        .from('cohort_students')
        .select('student_id')
        .eq('cohort_id', cohort.id)
        .eq('is_active', true);
      if (rosterError) throw rosterError;
      const rosterIds = new Set((rosterRows || []).map((row) => String(row.student_id)));
      if (rosterIds.size) {
        const before = targetStudents.length;
        targetStudents = targetStudents.filter((student) => rosterIds.has(String(student.id)));
        skippedNotEnrolled = before - targetStudents.length;
      }
    }

    if (!targetStudents.length) {
      return Response.json({
        error: cohort
          ? `${cohort.name} 수강 명단에 있는 생성 대상 학생이 없습니다. 설정 · 기수 관리에서 명단을 먼저 만들어 주세요.`
          : '일괄 생성 대상 학생이 없습니다.',
      }, { status: 400 });
    }

    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const operatingDates = dates
      .map((date) => ({ date, schedule: resolveScheduleForDate(scheduleConfig, date) }))
      .filter((item) => item.schedule.operating);
    const skippedRestDays = dates.length - operatingDates.length;

    const { data: existingRows, error: existingError } = await supabase
      .from('student_daily_schedules')
      .select('student_id,schedule_date')
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate)
      .in('student_id', targetStudents.map((student) => student.id));
    if (existingError) throw existingError;

    const existingKeys = new Set((existingRows || []).map((row) => `${row.student_id}|${row.schedule_date}`));

    const rowsToInsert = [];
    for (const { date, schedule } of operatingDates) {
      for (const student of targetStudents) {
        if (existingKeys.has(`${student.id}|${date}`)) continue;
        rowsToInsert.push({
          student_id: student.id,
          schedule_date: date,
          planned_check_in: schedule.plannedCheckIn,
          planned_check_out: schedule.plannedCheckOut,
          parent_confirmed: true,
          confirmation_note: null,
          schedule_note: `${schedule.scheduleLabel} · 일괄 생성`,
        });
      }
    }

    for (let index = 0; index < rowsToInsert.length; index += INSERT_CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(index, index + INSERT_CHUNK_SIZE);
      const { error: insertError } = await supabase.from('student_daily_schedules').insert(chunk);
      if (insertError) throw insertError;
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'schedule.bulk_generate',
      targetType: 'student_schedule',
      targetName: requestedIds && requestedIds.length === 1
        ? (targetStudents[0]?.name || requestedIds[0])
        : `학생 ${targetStudents.length}명`,
      payload: {
        startDate,
        endDate,
        studentCount: targetStudents.length,
        created: rowsToInsert.length,
        skippedExisting: existingKeys.size,
        skippedRestDays,
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
        clampedToCohort,
        skippedNotEnrolled,
      },
    });

    return Response.json({
      created: rowsToInsert.length,
      studentCount: targetStudents.length,
      operatingDayCount: operatingDates.length,
      skippedRestDays,
      skippedExisting: (existingRows || []).length,
      startDate,
      endDate,
      cohortId: cohort?.id || null,
      cohortName: cohort?.name || '',
      cohortStartDate: cohort?.startDate || null,
      cohortEndDate: cohort?.endDate || null,
      clampedToCohort,
      skippedNotEnrolled,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
