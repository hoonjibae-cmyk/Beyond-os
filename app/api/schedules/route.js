import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  const originalDate = d.getDate();
  d.setMonth(d.getMonth() + amount);
  if (d.getDate() !== originalDate) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function isWeekday(dateString) {
  const day = new Date(`${dateString}T00:00:00`).getDay();
  return day >= 1 && day <= 5;
}

function expandDates(start, repeat = 'none', until) {
  const safeRepeat = repeat || 'none';
  const end = until || start;
  const dates = [];
  let cursor = start;
  let guard = 0;

  while (cursor <= end && guard < 366) {
    if (safeRepeat !== 'weekdays' || isWeekday(cursor)) dates.push(cursor);
    if (safeRepeat === 'none') break;
    if (safeRepeat === 'daily' || safeRepeat === 'weekdays') cursor = addDays(cursor, 1);
    else if (safeRepeat === 'weekly') cursor = addDays(cursor, 7);
    else if (safeRepeat === 'monthly') cursor = addMonths(cursor, 1);
    else break;
    guard += 1;
  }
  return dates.length ? dates : [start];
}

function timeToMinutes(value) {
  if (!value) return null;
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function isFiveMinuteTime(value) {
  const minutes = timeToMinutes(value);
  return minutes === null || minutes % 5 === 0;
}

function validateScheduleBody(body) {
  const errors = [];
  const checkIn = timeToMinutes(body.plannedCheckIn || '09:00');
  const checkOut = timeToMinutes(body.plannedCheckOut || '22:00');

  if (!isFiveMinuteTime(body.plannedCheckIn || '09:00')) errors.push('예정 등원은 5분 단위로 입력하세요.');
  if (!isFiveMinuteTime(body.plannedCheckOut || '22:00')) errors.push('예정 하원은 5분 단위로 입력하세요.');
  if (checkIn !== null && checkOut !== null && checkOut <= checkIn) errors.push('예정 하원은 예정 등원보다 늦어야 합니다.');

  const breakRanges = [];
  for (const [index, item] of (Array.isArray(body.breaks) ? body.breaks : []).entries()) {
    const hasAny = Boolean(item.leaveStart || item.returnTime || item.reasonDetail || item.breakNote);
    if (!hasAny) continue;

    const leave = timeToMinutes(item.leaveStart);
    const ret = timeToMinutes(item.returnTime);

    if (leave === null) errors.push(`외출 ${index + 1}: 외출 시작 시간을 입력하세요.`);
    if (ret === null) errors.push(`외출 ${index + 1}: 복귀 예정 시간을 입력하세요.`);
    if (item.leaveStart && !isFiveMinuteTime(item.leaveStart)) errors.push(`외출 ${index + 1}: 외출 시작은 5분 단위로 입력하세요.`);
    if (item.returnTime && !isFiveMinuteTime(item.returnTime)) errors.push(`외출 ${index + 1}: 복귀 예정은 5분 단위로 입력하세요.`);
    if (leave !== null && ret !== null && ret <= leave) errors.push(`외출 ${index + 1}: 복귀 예정은 외출 시작보다 늦어야 합니다.`);
    if (checkIn !== null && leave !== null && leave < checkIn) errors.push(`외출 ${index + 1}: 외출 시작이 예정 등원보다 빠릅니다.`);
    if (checkOut !== null && ret !== null && ret > checkOut) errors.push(`외출 ${index + 1}: 복귀 예정이 예정 하원보다 늦습니다.`);

    if (leave !== null && ret !== null && ret > leave) breakRanges.push({ index, leave, ret });
  }

  breakRanges.sort((a, b) => a.leave - b.leave);
  for (let i = 1; i < breakRanges.length; i += 1) {
    if (breakRanges[i].leave < breakRanges[i - 1].ret) {
      errors.push(`외출 ${breakRanges[i - 1].index + 1}과 외출 ${breakRanges[i].index + 1} 시간이 겹칩니다.`);
    }
  }

  return errors;
}

async function upsertScheduleForDate(supabase, body, date) {
  const payload = {
    student_id: body.studentId,
    schedule_date: date,
    planned_check_in: body.plannedCheckIn || '09:00',
    planned_check_out: body.plannedCheckOut || '22:00',
    parent_confirmed: Boolean(body.parentConfirmed),
    confirmation_note: body.confirmationNote || null,
    schedule_note: body.scheduleNote || null,
  };

  const { data: schedule, error: scheduleError } = await supabase
    .from('student_daily_schedules')
    .upsert(payload, { onConflict: 'student_id,schedule_date' })
    .select()
    .single();
  if (scheduleError) throw scheduleError;
  return schedule;
}

async function replaceBreaksForSchedule(supabase, scheduleId, breaks) {
  const { error: deleteError } = await supabase
    .from('student_schedule_breaks')
    .delete()
    .eq('schedule_id', scheduleId);
  if (deleteError) throw deleteError;

  const validBreaks = (Array.isArray(breaks) ? breaks : [])
    .filter((item) => item.leaveStart)
    .map((item) => ({
      schedule_id: scheduleId,
      leave_start: item.leaveStart,
      return_time: item.returnTime || null,
      reason: item.reason || '기타',
      reason_detail: item.reasonDetail || null,
      break_note: item.breakNote || null,
    }));

  if (validBreaks.length > 0) {
    const { error: insertBreaksError } = await supabase
      .from('student_schedule_breaks')
      .insert(validBreaks);
    if (insertBreaksError) throw insertBreaksError;
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const start = searchParams.get('start') || today;
    const end = searchParams.get('end') || start;

    const { data: schedules, error: schedulesError } = await supabase
      .from('student_daily_schedules')
      .select('*, students(*)')
      .gte('schedule_date', start)
      .lte('schedule_date', end)
      .order('schedule_date', { ascending: true })
      .order('planned_check_in', { ascending: true });
    if (schedulesError) throw schedulesError;

    const ids = (schedules || []).map((schedule) => schedule.id);
    let breaks = [];
    if (ids.length > 0) {
      const { data: breakRows, error: breaksError } = await supabase
        .from('student_schedule_breaks')
        .select('*')
        .in('schedule_id', ids)
        .order('leave_start', { ascending: true });
      if (breaksError) throw breaksError;
      breaks = breakRows || [];
    }
    return Response.json({ start, end, schedules: schedules || [], breaks });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    if (!body.studentId || !body.scheduleDate) {
      return Response.json({ error: 'studentId and scheduleDate are required' }, { status: 400 });
    }

    const validationErrors = validateScheduleBody(body);
    if (validationErrors.length) {
      return Response.json({ error: validationErrors.join('\n') }, { status: 400 });
    }

    const commuteDates = expandDates(body.scheduleDate, body.commuteRepeat || 'none', body.commuteRepeatUntil || body.scheduleDate);
    const breakDates = expandDates(body.scheduleDate, body.breakRepeat || 'none', body.breakRepeatUntil || body.scheduleDate);
    const allDates = [...new Set([...commuteDates, ...breakDates])].sort();
    const savedSchedules = [];

    for (const date of allDates) {
      const schedule = await upsertScheduleForDate(supabase, body, date);
      savedSchedules.push(schedule);
      if (breakDates.includes(date)) {
        await replaceBreaksForSchedule(supabase, schedule.id, body.breaks || []);
      }
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'schedule.save',
      targetType: 'student_schedule',
      targetId: savedSchedules[0]?.id,
      targetName: body.studentName || body.studentId,
      payload: {
        studentId: body.studentId,
        affectedDates: allDates,
        commuteDates,
        breakDates,
        breakCount: Array.isArray(body.breaks) ? body.breaks.length : 0,
      },
    });

    return Response.json({ schedules: savedSchedules, affectedDates: allDates, commuteDates, breakDates });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

// 개인 시간표(등하원 조정 + 외출 일정)를 삭제합니다.
// v41-42부터 삭제하면 해당 날짜는 빈 날(등원 예정 없음)이 됩니다.
// v41-44: 저장과 동일한 반복 옵션(repeat/repeatUntil)으로 여러 날짜를 한 번에 삭제할 수 있습니다.
export async function DELETE(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const studentId = body.studentId || searchParams.get('studentId');
    const scheduleDate = body.scheduleDate || searchParams.get('scheduleDate');
    const repeat = body.repeat || searchParams.get('repeat') || 'none';
    const repeatUntil = body.repeatUntil || searchParams.get('repeatUntil') || scheduleDate;

    if (!studentId || !scheduleDate) {
      return Response.json({ error: 'studentId and scheduleDate are required' }, { status: 400 });
    }

    const targetDates = expandDates(scheduleDate, repeat, repeatUntil);
    const supabase = getSupabaseAdmin();
    const { data: schedules, error: findError } = await supabase
      .from('student_daily_schedules')
      .select('*, students(name)')
      .eq('student_id', studentId)
      .in('schedule_date', targetDates);
    if (findError) throw findError;

    if (!schedules?.length) {
      return Response.json({
        deleted: false,
        deletedCount: 0,
        message: repeat === 'none'
          ? '이 날짜에는 저장된 개인 시간표가 없습니다. (이미 빈 날)'
          : '선택한 반복 범위에 저장된 개인 시간표가 없습니다.',
      });
    }

    const scheduleIds = schedules.map((schedule) => schedule.id);
    const { error: breaksError } = await supabase
      .from('student_schedule_breaks')
      .delete()
      .in('schedule_id', scheduleIds);
    if (breaksError) throw breaksError;

    const { error: deleteError } = await supabase
      .from('student_daily_schedules')
      .delete()
      .in('id', scheduleIds);
    if (deleteError) throw deleteError;

    const deletedDates = schedules.map((schedule) => schedule.schedule_date).sort();
    await writeUserActionLog(supabase, request, {
      actionType: 'schedule.delete',
      targetType: 'student_schedule',
      targetId: scheduleIds[0],
      targetName: schedules[0]?.students?.name || body.studentName || studentId,
      payload: {
        studentId,
        scheduleDate,
        repeat,
        repeatUntil,
        deletedDates,
        deletedCount: scheduleIds.length,
      },
    });

    return Response.json({ deleted: true, deletedCount: scheduleIds.length, deletedDates, scheduleDate });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
