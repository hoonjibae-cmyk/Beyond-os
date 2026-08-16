import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import { loadScheduleCohortContext, planScheduleDates, describeBlockedDates, getCohortForDate } from '../../../lib/scheduleCohort';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

// v41-185: 개인 시간표는 기수 하나만 채웁니다.
// 반복 저장이 기수 경계를 넘어가면 경계에서 자르고, 어느 기수에도 속하지 않는
// 날짜는 아예 만들지 않습니다. body.allowCrossCohort 가 true 면 예전처럼 그대로 갑니다.
async function planDatesForCohort(supabase, body, dates) {
  const context = await loadScheduleCohortContext(supabase);
  return planScheduleDates(context, {
    anchorDate: body.scheduleDate,
    dates,
    allowCrossCohort: body.allowCrossCohort === true,
  });
}

function blockedResponse(plan) {
  return Response.json({
    error: describeBlockedDates(plan) || '기수 기간 안의 날짜가 아니어서 개인 시간표를 만들 수 없습니다.',
    blockedDates: plan.blocked,
    cohort: plan.cohort ? { id: plan.cohort.id, name: plan.cohort.name, startDate: plan.cohort.startDate, endDate: plan.cohort.endDate } : null,
  }, { status: 400 });
}

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
  const requestedDates = expandDatesForEvent(body.scheduleDate, body.repeatMode || 'none', body.repeatWeekdays || [], body.repeatUntil || body.scheduleDate);

  // v41-185: 기수 경계에서 자릅니다.
  const plan = await planDatesForCohort(supabase, body, requestedDates);
  if (!plan.allowed.length) return blockedResponse(plan);
  const dates = plan.allowed;
  const cohortNotice = describeBlockedDates(plan);

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

  const validBreakCount = (Array.isArray(body.breaks) ? body.breaks : []).filter((item) => item.leaveStart).length;

  const saved = [];
  for (const date of dates) {
    const { data: existing } = await supabase
      .from('student_daily_schedules')
      .select('*')
      .eq('student_id', body.studentId)
      .eq('schedule_date', date)
      .maybeSingle();

    // 외출 삭제(외출 항목 0개)인데 해당 날짜에 개인 시간표가 없으면, 빈 시간표를 새로 만들지 않고 건너뜁니다.
    if (scope === 'break' && validBreakCount === 0 && !existing) continue;

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
      // v41-132: plannedAbsent=false 로 오면 해당 날짜의 결석 처리를 해제합니다.
      const clearing = body.plannedAbsent === false;
      payload.planned_absent = !clearing;
      payload.absent_reason = clearing ? null : (body.absentReason || null);
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
    if (scope === 'absent' && absenceSupported && schedule.planned_absent) {
      await applyPlannedAbsentSession(supabase, { studentId: body.studentId, date, seatNo: defaultSeatNo, reason: body.absentReason || '' });
    } else if (absenceSupported && !schedule.planned_absent) {
      // v41-119: 결석이 아닌 이벤트를 저장했는데 그 날짜의 개인 시간표가 결석이 아니라면,
      // 이전에 자동 생성된 '[예약결석]' 세션이 남아있지 않도록 정리합니다.
      await rollbackPlannedAbsentSession(supabase, { studentId: body.studentId, date });
    }
    saved.push(schedule);
  }

  await writeUserActionLog(supabase, request, {
    actionType: 'schedule.save',
    targetType: 'student_schedule',
    targetId: saved[0]?.id,
    targetName: body.studentName || body.studentId,
    payload: {
      studentId: body.studentId,
      eventScope: scope,
      affectedDates: dates,
      repeatMode: body.repeatMode || 'none',
      repeatWeekdays: body.repeatWeekdays || [],
      cohortId: plan.cohort?.id || null,
      blockedCount: plan.blocked.length,
    },
  });

  return Response.json({
    schedules: saved,
    affectedDates: dates,
    eventScope: scope,
    blockedDates: plan.blocked,
    cohortNotice,
    cohort: plan.cohort ? { id: plan.cohort.id, name: plan.cohort.name } : null,
  });
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
    // v41-185: 반복 저장이 기수 경계를 넘지 않도록 자릅니다.
    const plan = await planDatesForCohort(supabase, body, [...commuteDates, ...breakDates, ...absentDates]);
    if (!plan.allowed.length) return blockedResponse(plan);
    const allowedSet = new Set(plan.allowed);
    const cohortNotice = describeBlockedDates(plan);

    const absentSet = new Set(absentDates.filter((date) => allowedSet.has(date)));
    const allDates = plan.allowed;
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
        cohortId: plan.cohort?.id || null,
        blockedCount: plan.blocked.length,
      },
    });

    return Response.json({
      schedules: savedSchedules,
      affectedDates: allDates,
      commuteDates: commuteDates.filter((date) => allowedSet.has(date)),
      breakDates: breakDates.filter((date) => allowedSet.has(date)),
      absentDates: [...absentSet].sort(),
      blockedDates: plan.blocked,
      cohortNotice,
      cohort: plan.cohort ? { id: plan.cohort.id, name: plan.cohort.name } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

// v41-187: 기수 기간 밖에 남아 있는 개인 시간표를 찾아 정리합니다.
//
// v41-185 는 앞으로의 생성만 막습니다. 그 전에 만들어진 시간표는 그대로 남아,
// 기수가 끝난 뒤에도 좌석배치도에 결석으로 뜨는 등 계속 영향을 줍니다.
//
// 판정
//   기간 밖 : 어느 기수 기간에도 들어가지 않는 날짜의 시간표
//   명단 밖 : 그 날짜가 속한 기수의 수강 명단에 없는 학생의 시간표
// 기본은 '기간 밖'만 지웁니다. 명단은 운영 중에 바뀔 수 있어서, 명단 밖까지
// 지우려면 요청에 includeNotEnrolled:true 를 넣어야 합니다.
async function cleanupSchedulesOutsideCohorts(supabase, request, body) {
  const dryRun = body.dryRun === true;
  const includeNotEnrolled = body.includeNotEnrolled === true;

  const context = await loadScheduleCohortContext(supabase);
  if (!context.enabled) {
    return Response.json({ error: '등록된 기수가 없어 기간 밖 여부를 판단할 수 없습니다.' }, { status: 400 });
  }

  const { data: rows, error: rowsError } = await supabase
    .from('student_daily_schedules')
    .select('id, student_id, schedule_date, planned_absent, students(name)')
    .order('schedule_date', { ascending: true });
  if (rowsError) throw rowsError;

  // 기수별 수강 명단 (명단이 비어 있는 기수는 판정에서 제외합니다)
  const rosterByCohort = new Map();
  if (includeNotEnrolled) {
    const { data: rosterRows, error: rosterError } = await supabase
      .from('cohort_students')
      .select('cohort_id, student_id')
      .eq('is_active', true);
    if (rosterError) throw rosterError;
    for (const row of rosterRows || []) {
      const key = String(row.cohort_id);
      if (!rosterByCohort.has(key)) rosterByCohort.set(key, new Set());
      rosterByCohort.get(key).add(String(row.student_id));
    }
  }

  const outsidePeriod = [];
  const notEnrolled = [];
  for (const row of rows || []) {
    const date = String(row.schedule_date || '').slice(0, 10);
    const cohort = getCohortForDate(context, date);
    if (!cohort) { outsidePeriod.push(row); continue; }
    if (!includeNotEnrolled) continue;
    const roster = rosterByCohort.get(String(cohort.id));
    if (roster && roster.size && !roster.has(String(row.student_id))) notEnrolled.push(row);
  }

  const targets = includeNotEnrolled ? [...outsidePeriod, ...notEnrolled] : outsidePeriod;
  const summarize = (list) => {
    const byStudent = new Map();
    for (const row of list) {
      const key = String(row.student_id);
      if (!byStudent.has(key)) {
        byStudent.set(key, { studentId: key, name: row.students?.name || key, count: 0, firstDate: null, lastDate: null });
      }
      const entry = byStudent.get(key);
      entry.count += 1;
      const date = String(row.schedule_date || '').slice(0, 10);
      if (!entry.firstDate || date < entry.firstDate) entry.firstDate = date;
      if (!entry.lastDate || date > entry.lastDate) entry.lastDate = date;
    }
    return [...byStudent.values()].sort((a, b) => b.count - a.count);
  };

  const result = {
    dryRun,
    includeNotEnrolled,
    total: targets.length,
    outsidePeriodCount: outsidePeriod.length,
    notEnrolledCount: notEnrolled.length,
    students: summarize(targets),
    cohorts: context.cohorts.map((cohort) => ({ name: cohort.name, startDate: cohort.startDate, endDate: cohort.endDate })),
  };

  if (dryRun || !targets.length) return Response.json({ ...result, deleted: 0 });

  const ids = targets.map((row) => row.id);
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { error: breaksError } = await supabase.from('student_schedule_breaks').delete().in('schedule_id', chunk);
    if (breaksError) throw breaksError;
    const { error: deleteError } = await supabase.from('student_daily_schedules').delete().in('id', chunk);
    if (deleteError) throw deleteError;
  }

  // 그 시간표를 근거로 만들어진 '[예약결석]' 세션도 함께 정리합니다.
  for (const row of targets) {
    if (row.planned_absent === false) continue;
    await rollbackPlannedAbsentSession(supabase, {
      studentId: row.student_id,
      date: String(row.schedule_date || '').slice(0, 10),
    });
  }

  await writeUserActionLog(supabase, request, {
    actionType: 'schedule.cleanup_outside_cohorts',
    targetType: 'student_schedule',
    targetName: `기수 밖 개인 시간표 ${targets.length}건`,
    payload: {
      deleted: targets.length,
      outsidePeriodCount: outsidePeriod.length,
      notEnrolledCount: notEnrolled.length,
      includeNotEnrolled,
    },
  });

  return Response.json({ ...result, deleted: targets.length });
}

// v41-194: 휴무일(공휴일·미운영 요일)에 남아 있는 개인 시간표를 한 번에 걷어냅니다.
//
// v41-193 은 '이번 저장으로 새로 휴무가 된 날짜'만 정리합니다.
// 그래서 예전에 이미 공휴일로 지정해 둔 날짜는 그대로 남아 있습니다.
// 이 정리는 지금 설정 기준으로 휴무인 날짜 전부를 훑습니다.
async function cleanupSchedulesOnClosedDates(supabase, request, body) {
  const dryRun = body.dryRun === true;
  const cohortId = String(body.cohortId || request.headers.get('x-beyond-cohort-id') || '').trim();

  const context = await loadScheduleCohortContext(supabase);
  let range = null;
  let cohort = null;
  if (cohortId && context.enabled) {
    cohort = context.cohorts.find((item) => String(item.id) === cohortId) || null;
    if (cohort) range = { start: cohort.startDate, end: cohort.endDate };
  }
  if (!range) {
    // 기수를 지정하지 않으면 저장된 개인 시간표가 있는 전체 구간을 봅니다.
    const { data: bounds, error: boundsError } = await supabase
      .from('student_daily_schedules')
      .select('schedule_date')
      .order('schedule_date', { ascending: true });
    if (boundsError) throw boundsError;
    if (!bounds?.length) return Response.json({ dryRun, total: 0, dates: [], students: [], deleted: 0 });
    range = {
      start: String(bounds[0].schedule_date).slice(0, 10),
      end: String(bounds[bounds.length - 1].schedule_date).slice(0, 10),
    };
  }

  const scheduleConfig = await getDefaultScheduleConfig(supabase);
  const closedDates = [];
  let cursor = range.start;
  let guard = 0;
  while (cursor <= range.end && guard <= 800) {
    if (!resolveScheduleForDate(scheduleConfig, cursor).operating) closedDates.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  if (!closedDates.length) {
    return Response.json({ dryRun, total: 0, dates: [], students: [], deleted: 0, range, cohortName: cohort?.name || '' });
  }

  let query = supabase
    .from('student_daily_schedules')
    .select('id, student_id, schedule_date, planned_absent, students(name)')
    .in('schedule_date', closedDates);
  if (cohort) {
    const { data: rosterRows, error: rosterError } = await supabase
      .from('cohort_students').select('student_id').eq('cohort_id', cohort.id).eq('is_active', true);
    if (rosterError) throw rosterError;
    const roster = (rosterRows || []).map((row) => String(row.student_id));
    if (roster.length) query = query.in('student_id', roster);
  }
  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw rowsError;

  const byStudent = new Map();
  const hitDates = new Set();
  for (const row of rows || []) {
    hitDates.add(String(row.schedule_date).slice(0, 10));
    const key = String(row.student_id);
    if (!byStudent.has(key)) byStudent.set(key, { studentId: key, name: row.students?.name || key, count: 0 });
    byStudent.get(key).count += 1;
  }
  const summary = {
    dryRun,
    total: (rows || []).length,
    dates: [...hitDates].sort(),
    closedDateCount: closedDates.length,
    students: [...byStudent.values()].sort((a, b) => b.count - a.count),
    range,
    cohortName: cohort?.name || '',
  };

  if (dryRun || !rows?.length) return Response.json({ ...summary, deleted: 0 });

  const ids = rows.map((row) => row.id);
  for (let index = 0; index < ids.length; index += 200) {
    const part = ids.slice(index, index + 200);
    const { error: breaksError } = await supabase.from('student_schedule_breaks').delete().in('schedule_id', part);
    if (breaksError) throw breaksError;
    const { error: deleteError } = await supabase.from('student_daily_schedules').delete().in('id', part);
    if (deleteError) throw deleteError;
  }
  for (const row of rows) {
    if (row.planned_absent === false) continue;
    await rollbackPlannedAbsentSession(supabase, {
      studentId: row.student_id,
      date: String(row.schedule_date).slice(0, 10),
    });
  }

  await writeUserActionLog(supabase, request, {
    actionType: 'schedule.cleanup_closed_dates',
    targetType: 'student_schedule',
    targetName: `휴무일 개인 시간표 ${ids.length}건`,
    payload: { deleted: ids.length, cohortId: cohort?.id || null, range },
  });

  return Response.json({ ...summary, deleted: ids.length });
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

    const supabase = getSupabaseAdmin();

    // v41-187: 기수 기간 밖에 남아 있는 개인 시간표 일괄 정리 (학생 지정 없이 전체 대상)
    if (mode === 'outsideCohorts') {
      return await cleanupSchedulesOutsideCohorts(supabase, request, body);
    }
    // v41-194: 휴무일에 남아 있는 개인 시간표 일괄 정리
    if (mode === 'closedDates') {
      return await cleanupSchedulesOnClosedDates(supabase, request, body);
    }

    if (!studentId) {
      return Response.json({ error: 'studentId is required' }, { status: 400 });
    }
    if (mode === 'single' && !scheduleDate) {
      return Response.json({ error: 'scheduleDate is required' }, { status: 400 });
    }
    if (mode === 'from' && !fromDate) {
      return Response.json({ error: 'fromDate is required' }, { status: 400 });
    }

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

    // v41-187: 시간표를 지우면 그 근거로 만들어진 '[예약결석]' 세션도 함께 정리합니다.
    // 지금까지는 세션이 남아 좌석배치도에 결석으로 계속 떴습니다.
    // planned_absent 컬럼이 없는 환경(undefined)에서는 안전하게 전부 확인합니다.
    // rollbackPlannedAbsentSession 은 자동 생성 세션만 지우므로 부작용이 없습니다.
    for (const schedule of schedules) {
      if (schedule.planned_absent === false) continue;
      await rollbackPlannedAbsentSession(supabase, { studentId, date: schedule.schedule_date });
    }
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
