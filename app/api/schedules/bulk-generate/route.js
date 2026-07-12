import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { writeUserActionLog } from '../../../../lib/actionLog';
import { getKstDateString } from '../../../../lib/date';
import { getDefaultScheduleConfig } from '../../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../../lib/defaultSchedule';

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

    const startDate = isValidDate(body.startDate) ? body.startDate : today;
    const endDate = isValidDate(body.endDate) ? body.endDate : addDays(startDate, 27);
    if (endDate < startDate) {
      return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });
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

    const targetStudents = (students || []).filter((student) => student.status !== 'inactive');
    if (!targetStudents.length) {
      return Response.json({ error: '일괄 생성 대상 학생이 없습니다.' }, { status: 400 });
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
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
