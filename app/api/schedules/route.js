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

// v41-96: 이벤트별 개별 설정용 반복 확장. mode: none | daily | weekdays | custom(weekdays 배열, getDay 0~6)
function expandDatesForEvent(start, mode = 'none', weekdays = [], until) {
  const safeMode = mode || 'none';
  const end = until || start;
  const daySet = new Set((Array.isArray(weekdays) ? weekdays : []).map(Number));
  const dates = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 366) {
    const dow = new Date(`${cursor}T00:00:00`).getDay();
    let include = false;
    if (safeMode === 'none') include = cursor === start;
    else if (safeMode === 'daily') include = true;
    else if (safeMode === 'weekdays') include = dow >= 1 && dow <= 5;
    else if (safeMode === 'custom') include = daySet.has(dow);
    if (include) dates.push(cursor);
    if (safeMode === 'none') break;
    cursor = addDays(cursor, 1);
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

async function upsertScheduleForDate(supabase, body, date, absence = {}) {
  const payload = {
    student_id: body.studentId,
    schedule_date: date,
    planned_check_in: body.plannedCheckIn || '09:00',
    planned_check_out: body.plannedCheckOut || '22:00',
    parent_confirmed: Boolean(body.parentConfirmed),
    confirmation_note: body.confirmationNote || null,
    schedule_note: body.scheduleNote || null,
  };
  // planned_absent 컬럼(마이그레이션)이 적용된 경우에만 결석 필드를 기록합니다.
  if (absence.absenceSupported) {
    payload.planned_absent = Boolean(absence.plannedAbsent);
    payload.absent_reason = absence.plannedAbsent ? (absence.absentReason || null) : null;
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('student_daily_schedules')
    .upsert(payload, { onConflict: 'student_id,schedule_date' })
    .select()
    .single();
  if (scheduleError) throw scheduleError;
  return schedule;
}

const PLANNED_ABSENCE_MARK = '[예약결석]';

// 예약 결석: 해당 날짜 세션을 자동으로 '결석'으로 만듭니다.
// 단, 이미 입실 기록(check_in_at)이 있으면 실제 출결을 덮어쓰지 않고 건너뜁니다.
async function applyPlannedAbsentSession(supabase, { studentId, date, seatNo, reason }) {
  const { data: existing } = await supabase
    .from('daily_sessions')
    .select('id, seat_no, check_in_at')
    .eq('student_id', studentId)
    .eq('session_date', date)
    .maybeSingle();

  if (existing?.check_in_at) return { skipped: 'has_check_in' };

  const seat = seatNo || existing?.seat_no || null;
  if (!seat) return { skipped: 'no_seat' }; // 좌석 정보가 없으면 세션 생성은 보류(스케줄에는 예약결석 기록됨)

  const memo = reason ? `${PLANNED_ABSENCE_MARK} ${reason}` : PLANNED_ABSENCE_MARK;
  const payload = {
    student_id: studentId,
    seat_no: seat,
    session_date: date,
    seat_status: 'absent',
    check_in_at: null,
    check_out_at: null,
    away_started_at: null,
    away_total_minutes: 0,
    pure_study_minutes: 0,
    pure_study_manual_text: null,
    attendance_memo: memo,
  };
  const { error } = await supabase
    .from('daily_sessions')
    .upsert(payload, { onConflict: 'student_id,session_date' });
  if (error) throw error;
  return { applied: true };
}

// 예약 결석 해제: 우리가 만든(체크인 없고 [예약결석] 메모) 결석 세션만 되돌립니다.
// 수동 결석/실제 출결은 건드리지 않습니다.
async function rollbackPlannedAbsentSession(supabase, { studentId, date }) {
  const { data: existing } = await supabase
    .from('daily_sessions')
    .select('id, seat_status, check_in_at, attendance_memo')
    .eq('student_id', studentId)
    .eq('session_date', date)
    .maybeSingle();
  if (!existing) return;
  if (existing.seat_status === 'absent'
    && !existing.check_in_at
    && String(existing.attendance_memo || '').startsWith(PLANNED_ABSENCE_MARK)) {
    await supabase.from('daily_sessions').delete().eq('id', existing.id);
  }
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

// v41-96: 이벤트별(등하원/외출/결석) 개별 저장.
// 선택한 이벤트만 반복 날짜에 적용하고, 같은 날짜의 다른 이벤트 필드는 기존 값을 보존합니다.
async function saveScopedEvent(supabase, request, body) {
  const scope = body.eventScope;
  const dates = expandDatesForEvent(body.scheduleDate, body.repeatMode || 'none', body.repeatWeekdays || [], body.repeatUntil || body.scheduleDate);

  let absenceSupported = true;
  try {
    const { error: probeError } = await supabase
      .from('student_daily_schedules')
      .select('planned_absent')
      .eq('student_id', body.studentId)
      .limit(1);
    if (probeError) throw probeError;
  } catch {
    absenceSupported = false;
  }
  if (scope === 'absent' && !absenceSupported) {
    return Response.json({ error: '결석 일정 기능을 쓰려면 beyond-os-supabase-planned-absence-v41-73.sql을 먼저 실행하세요. (planned_absent 컬럼 없음)' }, { status: 400 });
  }

  let defaultSeatNo = null;
  if (scope === 'absent') {
    const { data: studentRow } = await supabase.from('students').select('default_seat_no').eq('id', body.studentId).maybeSingle();
    defaultSeatNo = studentRow?.default_seat_no || null;
  }

  const saved = [];
  for (const date of dates) {
    const { data: existing } = await supabase
      .from('student_daily_schedules')
      .select('*')
      .eq('student_id', body.studentId)
      .eq('schedule_date', date)
      .maybeSingle();

    const payload = {
      student_id: body.studentId,
      schedule_date: date,
      planned_check_in: existing?.planned_check_in || body.plannedCheckIn || '09:00',
      planned_check_out: existing?.planned_check_out || body.plannedCheckOut || '22:00',
      parent_confirmed: existing?.parent_confirmed ?? false,
      confirmation_note: existing?.confirmation_note ?? null,
      schedule_note: existing?.schedule_note ?? null,
    };
    if (absenceSupported) {
      payload.planned_absent = existing?.planned_absent ?? false;
      payload.absent_reason = existing?.absent_reason ?? null;
    }

    if (scope === 'commute') {
      payload.planned_check_in = body.plannedCheckIn || payload.planned_check_in;
      payload.planned_check_out = body.plannedCheckOut || payload.planned_check_out;
      payload.parent_confirmed = Boolean(body.parentConfirmed);
      payload.confirmation_note = body.confirmationNote || null;
      payload.schedule_note = body.scheduleNote || null;
    } else if (scope === 'absent') {
      payload.planned_absent = true;
      payload.absent_reason = body.absentReason || null;
    }

    const { data: schedule, error: scheduleError } = await supabase
      .from('student_daily_schedules')
      .upsert(payload, { onConflict: 'student_id,schedule_date' })
      .select()
      .single();
    if (scheduleError) throw scheduleError;

    if (scope === 'break') {
      await replaceBreaksForSchedule(supabase, schedule.id, body.breaks || []);
    }
    if (scope === 'absent' && absenceSupported) {
      await applyPlannedAbsentSession(supabase, { studentId: body.studentId, date, seatNo: defaultSeatNo, reason: body.absentReason || '' });
    }
    saved.push(schedule);
  }

  await writeUserActionLog(supabase, request, {
    actionType: 'schedule.save',
    targetType: 'student_schedule',
    targetId: saved[0]?.id,
    targetName: body.studentName || body.studentId,
    payload: { studentId: body.studentId, eventScope: scope, affectedDates: dates, repeatMode: body.repeatMode || 'none', repeatWeekdays: body.repeatWeekdays || [] },
  });

  return Response.json({ schedules: saved, affectedDates: dates, eventScope: scope });
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

    // v41-96: 이벤트별 개별 저장(등하원/외출/결석 중 하나만, 선택 이벤트만 반복 적용, 그 날 다른 이벤트는 보존)
    if (body.eventScope) {
      return await saveScopedEvent(supabase, request, body);
    }

    const commuteDates = expandDates(body.scheduleDate, body.commuteRepeat || 'none', body.commuteRepeatUntil || body.scheduleDate);
    const breakDates = expandDates(body.scheduleDate, body.breakRepeat || 'none', body.breakRepeatUntil || body.scheduleDate);
    const absentDates = body.plannedAbsent
      ? expandDates(body.scheduleDate, body.absentRepeat || 'none', body.absentRepeatUntil || body.scheduleDate)
      : [];
    const absentSet = new Set(absentDates);
    const allDates = [...new Set([...commuteDates, ...breakDates, ...absentDates])].sort();
    const savedSchedules = [];

    // planned_absent 컬럼(마이그레이션) 적용 여부를 확인하고, 롤백 판정을 위해 이전 값을 읽어둡니다.
    let absenceSupported = true;
    let priorAbsentByDate = {};
    let defaultSeatNo = null;
    try {
      const { data: priorRows, error: priorError } = await supabase
        .from('student_daily_schedules')
        .select('schedule_date, planned_absent')
        .eq('student_id', body.studentId)
        .in('schedule_date', allDates);
      if (priorError) throw priorError;
      for (const row of priorRows || []) priorAbsentByDate[row.schedule_date] = Boolean(row.planned_absent);
    } catch {
      absenceSupported = false; // planned_absent 컬럼 미적용 환경
    }
    if (absenceSupported) {
      const { data: studentRow } = await supabase
        .from('students')
        .select('default_seat_no')
        .eq('id', body.studentId)
        .maybeSingle();
      defaultSeatNo = studentRow?.default_seat_no || null;
    }

    // 결석 일정을 사용하려는데 컬럼이 없으면 명확히 안내합니다. (일반 저장은 그대로 동작)
    if (body.plannedAbsent && !absenceSupported) {
      return Response.json({
        error: '결석 일정 기능을 쓰려면 beyond-os-supabase-planned-absence-v41-73.sql을 먼저 실행하세요. (planned_absent 컬럼 없음)',
      }, { status: 400 });
    }

    for (const date of allDates) {
      const isAbsentDate = absentSet.has(date);
      const schedule = await upsertScheduleForDate(supabase, body, date, {
        absenceSupported,
        plannedAbsent: isAbsentDate,
        absentReason: body.absentReason || '',
      });
      savedSchedules.push(schedule);
      if (breakDates.includes(date)) {
        await replaceBreaksForSchedule(supabase, schedule.id, body.breaks || []);
      }
      if (absenceSupported && isAbsentDate) {
        await applyPlannedAbsentSession(supabase, { studentId: body.studentId, date, seatNo: defaultSeatNo, reason: body.absentReason || '' });
      } else if (absenceSupported && priorAbsentByDate[date]) {
        await rollbackPlannedAbsentSession(supabase, { studentId: body.studentId, date });
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
        absentDates,
        breakCount: Array.isArray(body.breaks) ? body.breaks.length : 0,
      },
    });

    return Response.json({ schedules: savedSchedules, affectedDates: allDates, commuteDates, breakDates, absentDates });
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
    // mode: 'single'(기본, repeat 지원) | 'from'(fromDate 이후 전부) | 'all'(전체 기간)
    const mode = body.mode || searchParams.get('mode') || 'single';
    const repeat = body.repeat || searchParams.get('repeat') || 'none';
    const repeatUntil = body.repeatUntil || searchParams.get('repeatUntil') || scheduleDate;
    const fromDate = body.fromDate || searchParams.get('fromDate') || scheduleDate;

    if (!studentId) {
      return Response.json({ error: 'studentId is required' }, { status: 400 });
    }
    if (mode === 'single' && !scheduleDate) {
      return Response.json({ error: 'scheduleDate is required' }, { status: 400 });
    }
    if (mode === 'from' && !fromDate) {
      return Response.json({ error: 'fromDate is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let findQuery = supabase
      .from('student_daily_schedules')
      .select('*, students(name)')
      .eq('student_id', studentId);
    if (mode === 'from') findQuery = findQuery.gte('schedule_date', fromDate);
    else if (mode !== 'all') findQuery = findQuery.in('schedule_date', expandDates(scheduleDate, repeat, repeatUntil));
    const { data: schedules, error: findError } = await findQuery;
    if (findError) throw findError;

    if (!schedules?.length) {
      return Response.json({
        deleted: false,
        deletedCount: 0,
        message: mode === 'all'
          ? '저장된 개인 시간표가 없습니다.'
          : mode === 'from'
            ? `${fromDate} 이후에 저장된 개인 시간표가 없습니다.`
            : repeat === 'none'
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
        mode,
        scheduleDate,
        fromDate: mode === 'from' ? fromDate : undefined,
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
