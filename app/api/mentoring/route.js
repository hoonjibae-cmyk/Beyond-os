import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';

export const dynamic = 'force-dynamic';

const DEFAULT_MENTORS = [
  { mentor_code: 'mentor_a', mentor_name: '학습멘토 A', capacity_target: 13, sort_order: 1, is_active: true },
  { mentor_code: 'mentor_b', mentor_name: '학습멘토 B', capacity_target: 13, sort_order: 2, is_active: true },
];

const DEFAULT_SLOT_WINDOWS = [
  ['1차시', '09:00', '09:50'],
  ['2차시', '10:00', '10:50'],
  ['3차시', '11:00', '11:50'],
  ['4차시', '13:00', '13:50'],
  ['5차시', '14:00', '14:50'],
  ['6차시', '15:00', '15:50'],
  ['7차시', '16:00', '16:50'],
  ['8차시', '17:00', '17:50'],
];
const DEFAULT_MENTORING_DAYS = [1, 3, 5];
const ALLOWED_MENTORING_DAYS = [1, 2, 3, 4, 5];

function normalizeSlotClock(value) {
  return String(value || '').slice(0, 5);
}

function slotNumberFromLabel(label = '') {
  const match = String(label || '').match(/(\d+)\s*차시/);
  const number = match ? Number(match[1]) : null;
  return Number.isFinite(number) ? number : null;
}

function normalizeSlotLabelKey(label = '') {
  const number = slotNumberFromLabel(label);
  return number ? `${number}차시` : String(label || '').trim();
}

function buildMentoringSlotWindowsFromDefaultSchedule(defaultSchedule = {}) {
  const rawWindows = Array.isArray(defaultSchedule.studyWindows || defaultSchedule.study_windows)
    ? (defaultSchedule.studyWindows || defaultSchedule.study_windows)
    : [];
  const byNumber = new Map();
  const fallbackByNumber = new Map(DEFAULT_SLOT_WINDOWS.map(([label, start, end], index) => [index + 1, { label, start, end }]));

  rawWindows.forEach((item, index) => {
    const label = String(item?.label || `${index + 1}차시`).trim() || `${index + 1}차시`;
    const number = slotNumberFromLabel(label);
    const start = normalizeSlotClock(item?.start);
    const end = normalizeSlotClock(item?.end);
    if (!number || number < 1 || number > 8 || byNumber.has(number)) return;
    if (timeToMinutes(start) === null || timeToMinutes(end) === null || timeToMinutes(end) <= timeToMinutes(start)) return;
    byNumber.set(number, { label, start, end });
  });

  // 차시명이 1~8차시 형태가 아닌 커스텀 기본 시간표도 지원하기 위해
  // 시간 순서상 앞의 8개 구간을 보조 후보로 사용합니다.
  const orderedFallback = rawWindows
    .map((item, index) => {
      const start = normalizeSlotClock(item?.start);
      const end = normalizeSlotClock(item?.end);
      if (timeToMinutes(start) === null || timeToMinutes(end) === null || timeToMinutes(end) <= timeToMinutes(start)) return null;
      return { label: String(item?.label || `${index + 1}차시`).trim() || `${index + 1}차시`, start, end, startMinute: timeToMinutes(start) };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute)
    .slice(0, 8);

  const result = [];
  for (let number = 1; number <= 8; number += 1) {
    const direct = byNumber.get(number);
    const ordered = orderedFallback[number - 1];
    const fallback = fallbackByNumber.get(number);
    const source = direct || ordered || fallback;
    result.push({
      label: direct ? direct.label : `${number}차시`,
      start: source.start,
      end: source.end,
    });
  }
  return result;
}

async function getDefaultMentoringSlotWindows(supabase) {
  const settings = await getDefaultScheduleSettings(supabase);
  return buildMentoringSlotWindowsFromDefaultSchedule(settings);
}


function addDays(dateString, amount) {
  const d = new Date(`${dateString}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function getKstDayOfWeek(dateString = getKstDateString()) {
  return new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
}

function getNextDateForDay(dayOfWeek, today = getKstDateString()) {
  const current = getKstDayOfWeek(today);
  const diff = (Number(dayOfWeek) - current + 7) % 7;
  return addDays(today, diff);
}

function normalizeRepeatDays(body = {}, fallbackDay) {
  const raw = Array.isArray(body.repeatDayOfWeeks || body.repeatDays || body.dayOfWeeks)
    ? (body.repeatDayOfWeeks || body.repeatDays || body.dayOfWeeks)
    : [body.dayOfWeek || fallbackDay];
  const days = [...new Set(raw.map(Number).filter((day) => ALLOWED_MENTORING_DAYS.includes(day)))].sort((a, b) => a - b);
  return days.length ? days : [Number(fallbackDay || 1)];
}

function normalizeStudentIds(body = {}) {
  const source = Array.isArray(body.studentIds || body.student_ids)
    ? (body.studentIds || body.student_ids)
    : [body.studentId || body.student_id].filter(Boolean);
  return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isAssignmentActiveOnDate(item = {}, dateString = getKstDateString()) {
  const start = item.valid_from || item.start_date;
  const end = item.valid_to || item.end_date;
  if (start && String(start).slice(0, 10) > dateString) return false;
  if (end && String(end).slice(0, 10) < dateString) return false;
  return item.is_active !== false;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function formatConflictReason(conflict) {
  return [
    `${conflict.studentName || '학생'} · ${conflict.dayLabel || ''} ${conflict.slotLabel || ''} ${conflict.slotTime || ''}`.trim(),
    `기준일: ${conflict.date}`,
    `개인시간표: ${conflict.plannedRange || '확인 불가'}`,
    `사유: ${conflict.reason || '학습실 내 시간이 아님'}`,
  ].filter(Boolean).join('\n');
}

function dayLabel(day) {
  const number = Number(day);
  if (number === 0) return '일요일';
  if (number === 1) return '월요일';
  if (number === 2) return '화요일';
  if (number === 3) return '수요일';
  if (number === 4) return '목요일';
  if (number === 5) return '금요일';
  if (number === 6) return '토요일';
  return `${day}요일`;
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function sanitizeSlot(body = {}) {
  const day = Number(body.dayOfWeek || body.day_of_week || 1);
  const label = String(body.slotLabel || body.slot_label || '').trim() || '멘토링 차시';
  const start = String(body.startTime || body.start_time || '').slice(0, 5);
  const end = String(body.endTime || body.end_time || '').slice(0, 5);
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const minCapacity = Math.max(1, Math.min(20, Number(body.minCapacity || body.min_capacity || 3)));
  const maxCapacity = Math.max(minCapacity, Math.min(20, Number(body.maxCapacity || body.max_capacity || 4)));
  const errors = [];
  if (!ALLOWED_MENTORING_DAYS.includes(day)) errors.push('멘토링 요일은 평일(월~금)만 선택할 수 있습니다.');
  if (startMinutes === null) errors.push('시작 시간을 입력하세요.');
  if (endMinutes === null) errors.push('종료 시간을 입력하세요.');
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) errors.push('종료 시간은 시작 시간보다 늦어야 합니다.');
  if (startMinutes !== null && startMinutes % 5 !== 0) errors.push('시작 시간은 5분 단위로 입력하세요.');
  if (endMinutes !== null && endMinutes % 5 !== 0) errors.push('종료 시간은 5분 단위로 입력하세요.');
  return {
    errors,
    payload: {
      day_of_week: day,
      slot_label: label,
      start_time: start,
      end_time: end,
      min_capacity: minCapacity,
      max_capacity: maxCapacity,
      sort_order: Number(body.sortOrder || body.sort_order || startMinutes || 0),
      is_active: body.isActive === false || body.is_active === false ? false : true,
    },
  };
}


function normalizeDateString(value = getKstDateString(), fallback = getKstDateString()) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function isMissingTableError(error, tableName = '') {
  const message = String(error?.message || '').toLowerCase();
  const name = String(tableName || '').toLowerCase();
  return error?.code === '42P01'
    || message.includes('does not exist')
    || message.includes('schema cache')
    || (name && message.includes(name));
}

function dateSlotLabel(slot = {}) {
  return `${String(slot.start_time || '').slice(0, 5)}~${String(slot.end_time || '').slice(0, 5)}`;
}

function mapDateSlotForClient(slot = {}) {
  if (!slot) return slot;
  return {
    ...slot,
    day_of_week: Number(slot.day_of_week || getKstDayOfWeek(slot.schedule_date)),
    is_date_slot: true,
  };
}

function isAutoTemplateDateSlot(slot = {}) {
  if (!slot.template_slot_id) return false;
  const note = String(slot.note || '');
  return !note || note.includes('요일 템플릿 자동 반영') || note.includes('요일 기본값');
}

async function syncAutoDateSlotsWithTemplate(supabase, dateSlots = [], templateSlots = []) {
  const templateMap = new Map((templateSlots || []).map((slot) => [String(slot.id), slot]));
  let updatedCount = 0;
  for (const dateSlot of dateSlots || []) {
    if (!isAutoTemplateDateSlot(dateSlot)) continue;
    const template = templateMap.get(String(dateSlot.template_slot_id));
    if (!template || template.is_active === false) continue;
    const payload = {
      day_of_week: Number(template.day_of_week || dateSlot.day_of_week),
      slot_label: template.slot_label,
      start_time: normalizeSlotClock(template.start_time),
      end_time: normalizeSlotClock(template.end_time),
      min_capacity: template.min_capacity || dateSlot.min_capacity || 3,
      max_capacity: template.max_capacity || dateSlot.max_capacity || 4,
      sort_order: template.sort_order || dateSlot.sort_order || timeToMinutes(template.start_time) || 99,
      note: '요일 템플릿 자동 반영',
    };
    const changed = String(dateSlot.slot_label || '') !== String(payload.slot_label || '')
      || normalizeSlotClock(dateSlot.start_time) !== payload.start_time
      || normalizeSlotClock(dateSlot.end_time) !== payload.end_time
      || Number(dateSlot.min_capacity || 3) !== Number(payload.min_capacity || 3)
      || Number(dateSlot.max_capacity || 4) !== Number(payload.max_capacity || 4)
      || Number(dateSlot.sort_order || 0) !== Number(payload.sort_order || 0);
    if (!changed) continue;
    const { error } = await supabase.from('mentoring_date_slots').update(payload).eq('id', dateSlot.id);
    if (error) throw error;
    updatedCount += 1;
  }
  return updatedCount;
}

async function getScheduleConflictsForPairs(supabase, pairs = []) {
  const safePairs = (pairs || []).filter((pair) => pair?.studentId && pair?.slot && pair?.date);
  if (!safePairs.length) return [];

  const defaultSchedule = await getDefaultScheduleSettings(supabase);
  const studentIds = [...new Set(safePairs.map((pair) => String(pair.studentId)).filter(Boolean))];
  const dates = [...new Set(safePairs.map((pair) => normalizeDateString(pair.date)).filter(Boolean))];

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, name, school, grade, status')
    .in('id', studentIds);
  if (studentsError) throw studentsError;
  const studentMap = Object.fromEntries((students || []).map((student) => [String(student.id), student]));

  const { data: schedules, error: schedulesError } = await supabase
    .from('student_daily_schedules')
    .select('*, students(id, name, school, grade)')
    .in('student_id', studentIds)
    .in('schedule_date', dates);
  if (schedulesError) throw schedulesError;
  const scheduleMap = new Map();
  for (const schedule of schedules || []) scheduleMap.set(`${schedule.student_id}-${schedule.schedule_date}`, schedule);

  const scheduleIds = (schedules || []).map((schedule) => schedule.id).filter(Boolean);
  let breaks = [];
  if (scheduleIds.length) {
    const { data: breakRows, error: breaksError } = await supabase
      .from('student_schedule_breaks')
      .select('*')
      .in('schedule_id', scheduleIds)
      .order('leave_start', { ascending: true });
    if (breaksError) throw breaksError;
    breaks = breakRows || [];
  }
  const breaksBySchedule = {};
  for (const item of breaks) {
    if (!item.schedule_id) continue;
    if (!breaksBySchedule[item.schedule_id]) breaksBySchedule[item.schedule_id] = [];
    breaksBySchedule[item.schedule_id].push(item);
  }

  const conflicts = [];
  for (const pair of safePairs) {
    const studentId = String(pair.studentId);
    const date = normalizeDateString(pair.date);
    const student = studentMap[studentId] || { id: studentId, name: pair.studentName || '학생' };
    const slot = pair.slot || {};
    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);
    if (slotStart === null || slotEnd === null) continue;

    const schedule = scheduleMap.get(`${studentId}-${date}`) || {
      id: `default-${date}-${studentId}`,
      student_id: studentId,
      schedule_date: date,
      planned_check_in: defaultSchedule.plannedCheckIn,
      planned_check_out: defaultSchedule.plannedCheckOut,
      schedule_note: '기본 시간표 자동 적용',
      is_default_schedule: true,
    };
    const plannedIn = timeToMinutes(schedule.planned_check_in || defaultSchedule.plannedCheckIn);
    const plannedOut = timeToMinutes(schedule.planned_check_out || defaultSchedule.plannedCheckOut);
    const plannedRange = `${String(schedule.planned_check_in || defaultSchedule.plannedCheckIn).slice(0, 5)}~${String(schedule.planned_check_out || defaultSchedule.plannedCheckOut).slice(0, 5)}`;
    const base = {
      assignmentId: pair.assignmentId || null,
      dateAssignmentId: pair.dateAssignmentId || null,
      studentId,
      studentName: student.name || pair.studentName || '학생',
      date,
      dayOfWeek: Number(slot.day_of_week || getKstDayOfWeek(date)),
      dayLabel: dayLabel(Number(slot.day_of_week || getKstDayOfWeek(date))),
      slotId: pair.slotId || slot.id || null,
      dateSlotId: pair.dateSlotId || slot.id || null,
      slotLabel: slot.slot_label,
      slotTime: dateSlotLabel(slot),
      plannedRange,
      scheduleNote: schedule.schedule_note || null,
      isDefaultSchedule: Boolean(schedule.is_default_schedule),
      scope: pair.scope || 'weekly',
    };
    if (plannedIn === null || plannedOut === null || slotStart < plannedIn || slotEnd > plannedOut) {
      conflicts.push({ ...base, reason: '멘토링 차시가 예정 학습실 체류 시간 밖입니다.' });
      continue;
    }
    const scheduleBreaks = schedule.is_default_schedule ? [] : (breaksBySchedule[schedule.id] || []);
    const overlapBreak = scheduleBreaks.find((item) => {
      const leave = timeToMinutes(item.leave_start);
      const ret = timeToMinutes(item.return_time);
      return leave !== null && ret !== null && overlaps(slotStart, slotEnd, leave, ret);
    });
    if (overlapBreak) {
      conflicts.push({
        ...base,
        reason: `등록된 외출 시간 ${String(overlapBreak.leave_start || '').slice(0, 5)}~${String(overlapBreak.return_time || '').slice(0, 5)}${overlapBreak.reason_detail ? ` (${overlapBreak.reason_detail})` : ''}과 겹칩니다.`,
      });
    }
  }
  return conflicts;
}

async function getExistingWeeklyAssignmentConflicts(supabase, assignments = []) {
  const today = getKstDateString();
  const pairs = (assignments || [])
    .filter((item) => item?.is_active !== false && item?.student_id && item?.mentoring_slots)
    .map((item) => ({
      assignmentId: item.id,
      studentId: item.student_id,
      studentName: item.students?.name || '학생',
      slotId: item.slot_id,
      slot: item.mentoring_slots,
      date: getNextDateForDay(item.mentoring_slots?.day_of_week, today),
      scope: 'weekly',
    }));
  return getScheduleConflictsForPairs(supabase, pairs);
}

async function materializeDateSchedule(supabase, scheduleDateInput = getKstDateString()) {
  const scheduleDate = normalizeDateString(scheduleDateInput);
  const day = getKstDayOfWeek(scheduleDate);

  const { data: weeklySlots, error: weeklySlotsError } = await supabase
    .from('mentoring_slots')
    .select('*')
    .eq('is_active', true)
    .eq('day_of_week', day)
    .order('sort_order', { ascending: true })
    .order('start_time', { ascending: true });
  if (weeklySlotsError) throw weeklySlotsError;

  let { data: dateSlots, error: dateSlotsError } = await supabase
    .from('mentoring_date_slots')
    .select('*')
    .eq('schedule_date', scheduleDate);
  if (dateSlotsError) throw dateSlotsError;

  const syncedTemplateSlotCount = await syncAutoDateSlotsWithTemplate(supabase, dateSlots || [], weeklySlots || []);
  if (syncedTemplateSlotCount) {
    const reload = await supabase.from('mentoring_date_slots').select('*').eq('schedule_date', scheduleDate);
    if (reload.error) throw reload.error;
    dateSlots = reload.data || [];
  }

  // 한 번 날짜별 화면에서 비활성화한 템플릿 차시는 다시 자동 생성되면 안 됩니다.
  // 그래서 활성/비활성 여부와 관계없이 해당 날짜에 override 행이 있으면 이미 존재하는 것으로 봅니다.
  const dateSlotsByTemplate = new Map((dateSlots || []).filter((slot) => slot.template_slot_id).map((slot) => [String(slot.template_slot_id), slot]));
  const missingDateSlots = [];
  for (const slot of weeklySlots || []) {
    if (dateSlotsByTemplate.has(String(slot.id))) continue;
    missingDateSlots.push({
      schedule_date: scheduleDate,
      template_slot_id: slot.id,
      day_of_week: day,
      slot_label: slot.slot_label,
      start_time: String(slot.start_time || '').slice(0, 5),
      end_time: String(slot.end_time || '').slice(0, 5),
      min_capacity: slot.min_capacity || 3,
      max_capacity: slot.max_capacity || 4,
      sort_order: slot.sort_order || timeToMinutes(slot.start_time) || 99,
      note: '요일 템플릿 자동 반영',
      is_active: true,
    });
  }
  if (missingDateSlots.length) {
    const { error: insertSlotError } = await supabase.from('mentoring_date_slots').insert(missingDateSlots);
    if (insertSlotError) throw insertSlotError;
    const reload = await supabase.from('mentoring_date_slots').select('*').eq('schedule_date', scheduleDate).eq('is_active', true);
    if (reload.error) throw reload.error;
    dateSlots = reload.data || [];
  }

  const activeDateSlots = (dateSlots || []).filter((slot) => slot.is_active !== false);
  const activeDateSlotByTemplate = new Map(activeDateSlots.filter((slot) => slot.template_slot_id).map((slot) => [String(slot.template_slot_id), slot]));
  const weeklySlotIds = (weeklySlots || []).map((slot) => slot.id).filter(Boolean);
  if (!weeklySlotIds.length) return { insertedSlots: missingDateSlots.length, insertedAssignments: 0, scheduleDate };

  const { data: weeklyAssignments, error: weeklyAssignmentsError } = await supabase
    .from('mentoring_assignments')
    .select('*, students(status)')
    .eq('is_active', true)
    .in('slot_id', weeklySlotIds);
  if (weeklyAssignmentsError) throw weeklyAssignmentsError;

  const { data: existingDateAssignments, error: existingDateAssignmentsError } = await supabase
    .from('mentoring_date_assignments')
    .select('*')
    .eq('schedule_date', scheduleDate);
  if (existingDateAssignmentsError) throw existingDateAssignmentsError;
  // 날짜별 화면에서 템플릿 복사 배정을 삭제하면 is_active=false override가 남습니다.
  // 이 비활성 행을 무시하고 다시 자동 복사하면 삭제가 안 된 것처럼 보이므로 전체 행을 기준으로 판단합니다.
  const existingByTemplateAssignment = new Map((existingDateAssignments || []).filter((item) => item.template_assignment_id).map((item) => [String(item.template_assignment_id), item]));

  const inserts = [];
  for (const assignment of weeklyAssignments || []) {
    if (assignment.students?.status === 'inactive') continue;
    if (!isAssignmentActiveOnDate(assignment, scheduleDate)) continue;
    if (existingByTemplateAssignment.has(String(assignment.id))) continue;
    const dateSlot = activeDateSlotByTemplate.get(String(assignment.slot_id));
    if (!dateSlot) continue;
    inserts.push({
      schedule_date: scheduleDate,
      template_assignment_id: assignment.id,
      date_slot_id: dateSlot.id,
      student_id: assignment.student_id,
      mentor_id: assignment.mentor_id,
      note: assignment.note || null,
      is_active: true,
    });
  }
  if (inserts.length) {
    const { error: insertAssignmentError } = await supabase.from('mentoring_date_assignments').insert(inserts);
    if (insertAssignmentError) throw insertAssignmentError;
  }

  return { insertedSlots: missingDateSlots.length, insertedAssignments: inserts.length, scheduleDate };
}

async function loadDateSchedule(supabase, scheduleDateInput = getKstDateString(), options = {}) {
  const scheduleDate = normalizeDateString(scheduleDateInput);
  const day = getKstDayOfWeek(scheduleDate);
  let warning = '';

  const buildVirtualDateSchedule = async (extraWarning = '') => {
    const weeklySlotsSource = Array.isArray(options.weeklySlots) ? options.weeklySlots : [];
    const weeklyAssignmentsSource = Array.isArray(options.weeklyAssignments) ? options.weeklyAssignments : [];
    let weeklySlots = weeklySlotsSource
      .filter((slot) => slot.is_active !== false && Number(slot.day_of_week) === Number(day))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
    let weeklyAssignments = weeklyAssignmentsSource;

    if (!weeklySlotsSource.length) {
      const { data: slotRows, error: slotRowsError } = await supabase
        .from('mentoring_slots')
        .select('*')
        .eq('is_active', true)
        .eq('day_of_week', day)
        .order('sort_order', { ascending: true })
        .order('start_time', { ascending: true });
      if (slotRowsError) throw slotRowsError;
      weeklySlots = slotRows || [];
    }

    const slotIds = new Set(weeklySlots.map((slot) => String(slot.id)));
    if (!weeklyAssignmentsSource.length && slotIds.size) {
      const { data: assignmentRows, error: assignmentRowsError } = await supabase
        .from('mentoring_assignments')
        .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(*), mentoring_slots(*)')
        .eq('is_active', true)
        .in('slot_id', Array.from(slotIds));
      if (assignmentRowsError) throw assignmentRowsError;
      weeklyAssignments = assignmentRows || [];
    }

    const slotMap = Object.fromEntries(weeklySlots.map((slot) => [String(slot.id), slot]));
    const dateSlots = weeklySlots.map((slot) => ({
      ...slot,
      schedule_date: scheduleDate,
      template_slot_id: slot.id,
      is_virtual_date: true,
      is_date_slot: false,
      source_scope: 'weekly-template',
    }));
    const dateAssignments = (weeklyAssignments || [])
      .filter((item) => item?.is_active !== false && item.students?.status !== 'inactive' && slotIds.has(String(item.slot_id)) && isAssignmentActiveOnDate(item, scheduleDate))
      .map((item) => ({
        ...item,
        schedule_date: scheduleDate,
        date_slot_id: item.slot_id,
        template_assignment_id: item.id,
        mentoring_slots: item.mentoring_slots || slotMap[String(item.slot_id)] || null,
        is_virtual_date: true,
        is_date_assignment: false,
        source_scope: 'weekly-template',
      }));
    const dateAssignmentConflicts = await getScheduleConflictsForPairs(supabase, dateAssignments.map((item) => ({
      assignmentId: item.id,
      studentId: item.student_id,
      studentName: item.students?.name || '학생',
      slotId: item.slot_id,
      dateSlotId: item.slot_id,
      slot: item.mentoring_slots || slotMap[String(item.slot_id)],
      date: scheduleDate,
      scope: 'date-virtual',
    })));

    return {
      dateSlots,
      dateAssignments,
      dateAssignmentConflicts,
      dateWarning: [warning, extraWarning].filter(Boolean).join('\n'),
      dateScheduleDate: scheduleDate,
      dateScheduleDayOfWeek: day,
      dateOverrideActive: false,
    };
  };

  try {
    if (options.materialize) await materializeDateSchedule(supabase, scheduleDate);

    let { data: dateSlotsRaw, error: dateSlotsError } = await supabase
      .from('mentoring_date_slots')
      .select('*')
      .eq('schedule_date', scheduleDate)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('start_time', { ascending: true });
    if (dateSlotsError) throw dateSlotsError;

    const templateSlotIds = [...new Set((dateSlotsRaw || []).map((slot) => slot.template_slot_id).filter(Boolean).map(String))];
    if (templateSlotIds.length) {
      const { data: templateSlots, error: templateSlotsError } = await supabase
        .from('mentoring_slots')
        .select('*')
        .in('id', templateSlotIds);
      if (templateSlotsError) throw templateSlotsError;
      const syncedCount = await syncAutoDateSlotsWithTemplate(supabase, dateSlotsRaw || [], templateSlots || []);
      if (syncedCount) {
        const reload = await supabase
          .from('mentoring_date_slots')
          .select('*')
          .eq('schedule_date', scheduleDate)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('start_time', { ascending: true });
        if (reload.error) throw reload.error;
        dateSlotsRaw = reload.data || [];
      }
    }

    const dateSlots = (dateSlotsRaw || []).map(mapDateSlotForClient);

    if (!dateSlots.length) {
      return await buildVirtualDateSchedule('');
    }

    const dateSlotIds = dateSlots.map((slot) => slot.id).filter(Boolean);
    let dateAssignments = [];
    if (dateSlotIds.length) {
      const { data: rows, error: assignmentsError } = await supabase
        .from('mentoring_date_assignments')
        .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(*), mentoring_date_slots(*)')
        .eq('schedule_date', scheduleDate)
        .eq('is_active', true)
        .in('date_slot_id', dateSlotIds)
        .order('created_at', { ascending: true });
      if (assignmentsError) throw assignmentsError;
      // 비활성 학생의 날짜별 배정은 즉시 표시에서 제외합니다.
      dateAssignments = (rows || []).filter((item) => item.students?.status !== 'inactive').map((item) => ({
        ...item,
        slot_id: item.date_slot_id,
        mentoring_slots: mapDateSlotForClient(item.mentoring_date_slots),
        is_date_assignment: true,
        is_virtual_date: false,
      }));
    }

    const dateAssignmentConflicts = await getScheduleConflictsForPairs(supabase, dateAssignments.map((item) => ({
      dateAssignmentId: item.id,
      assignmentId: item.template_assignment_id || null,
      studentId: item.student_id,
      studentName: item.students?.name || '학생',
      dateSlotId: item.date_slot_id,
      slotId: item.date_slot_id,
      slot: item.mentoring_slots || item.mentoring_date_slots,
      date: scheduleDate,
      scope: 'date',
    })));

    return {
      dateSlots,
      dateAssignments,
      dateAssignmentConflicts,
      dateWarning: warning,
      dateScheduleDate: scheduleDate,
      dateScheduleDayOfWeek: day,
      dateOverrideActive: true,
    };
  } catch (error) {
    if (isMissingTableError(error, 'mentoring_date_slots') || isMissingTableError(error, 'mentoring_date_assignments')) {
      const tableWarning = '날짜별 멘토링 일정 테이블이 아직 없습니다. beyond-os-supabase-mentoring-date-overrides-v41-33.sql 실행 후 날짜별 수정 기능을 사용할 수 있습니다.';
      return await buildVirtualDateSchedule(tableWarning);
    }
    throw error;
  }
}

async function seedDefaults(supabase) {
  const { data: mentors, error: mentorError } = await supabase
    .from('mentoring_mentors')
    .select('id, mentor_code');
  if (mentorError) throw mentorError;
  const existingMentorCodes = new Set((mentors || []).map((item) => item.mentor_code));
  const missingMentors = DEFAULT_MENTORS.filter((item) => !existingMentorCodes.has(item.mentor_code));
  if (missingMentors.length) {
    const { error } = await supabase.from('mentoring_mentors').insert(missingMentors);
    if (error) throw error;
  }

  const defaultSlotWindows = await getDefaultMentoringSlotWindows(supabase);
  const { data: slots, error: slotError } = await supabase
    .from('mentoring_slots')
    .select('id, day_of_week, slot_label, start_time, end_time, min_capacity, max_capacity, sort_order, is_active');
  if (slotError) throw slotError;

  const activeSlotByDayLabel = new Map();
  for (const item of slots || []) {
    if (item.is_active === false) continue;
    const key = `${Number(item.day_of_week)}-${normalizeSlotLabelKey(item.slot_label)}`;
    if (!activeSlotByDayLabel.has(key)) activeSlotByDayLabel.set(key, []);
    activeSlotByDayLabel.get(key).push(item);
  }
  for (const list of activeSlotByDayLabel.values()) {
    list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  }

  const inserts = [];
  let updatedSlots = 0;
  for (const day of DEFAULT_MENTORING_DAYS) {
    defaultSlotWindows.forEach((slotWindow, index) => {
      const label = slotWindow.label || `${index + 1}차시`;
      const start = normalizeSlotClock(slotWindow.start);
      const end = normalizeSlotClock(slotWindow.end);
      const key = `${day}-${normalizeSlotLabelKey(label)}`;
      const existing = activeSlotByDayLabel.get(key)?.[0] || null;
      const payload = {
        day_of_week: day,
        slot_label: label,
        start_time: start,
        end_time: end,
        min_capacity: 3,
        max_capacity: 4,
        sort_order: day * 10000 + index * 100 + (timeToMinutes(start) || 0),
        is_active: true,
      };
      if (!existing) {
        inserts.push(payload);
        return;
      }
      const needsUpdate = String(existing.slot_label || '') !== String(payload.slot_label || '')
        || normalizeSlotClock(existing.start_time) !== payload.start_time
        || normalizeSlotClock(existing.end_time) !== payload.end_time
        || Number(existing.sort_order || 0) !== Number(payload.sort_order || 0)
        || Number(existing.min_capacity || 3) !== 3
        || Number(existing.max_capacity || 4) !== 4;
      if (needsUpdate) {
        updatedSlots += 1;
        activeSlotByDayLabel.set(key, [{ ...existing, ...payload, __needsUpdate: true }]);
      }
    });
  }

  for (const [key, list] of activeSlotByDayLabel.entries()) {
    const item = list?.[0];
    if (!item?.__needsUpdate) continue;
    const { id, __needsUpdate, ...payload } = item;
    const { error } = await supabase.from('mentoring_slots').update({
      slot_label: payload.slot_label,
      start_time: payload.start_time,
      end_time: payload.end_time,
      min_capacity: payload.min_capacity,
      max_capacity: payload.max_capacity,
      sort_order: payload.sort_order,
      is_active: true,
    }).eq('id', id);
    if (error) throw error;
  }

  if (inserts.length) {
    const { error } = await supabase.from('mentoring_slots').insert(inserts);
    if (error) throw error;
  }
  return {
    insertedMentors: missingMentors.length,
    insertedSlots: inserts.length,
    updatedSlots,
    slotSource: 'settings.default_schedule',
  };
}

async function loadMentorStudentLinks(supabase) {
  const { data, error } = await supabase
    .from('mentoring_mentor_students')
    .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(id, mentor_name, capacity_target, sort_order)')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (!error) return { rows: data || [], warning: '' };
  const message = String(error.message || '').toLowerCase();
  const missingTable = error.code === '42P01' || message.includes('mentoring_mentor_students') || message.includes('does not exist') || message.includes('schema cache');
  if (missingTable) {
    return {
      rows: [],
      warning: '멘토별 담당학생 설정 테이블이 아직 없습니다. beyond-os-supabase-mentoring-mentor-students-v41-31-4.sql 실행 후 사용할 수 있습니다.',
    };
  }
  throw error;
}

async function loadAll(supabase, options = {}) {
  const { data: mentors, error: mentorsError } = await supabase
    .from('mentoring_mentors')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('mentor_name', { ascending: true });
  if (mentorsError) throw mentorsError;

  const { data: slots, error: slotsError } = await supabase
    .from('mentoring_slots')
    .select('*')
    .order('day_of_week', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('start_time', { ascending: true });
  if (slotsError) throw slotsError;

  const { data: assignmentsRaw, error: assignmentsError } = await supabase
    .from('mentoring_assignments')
    .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(*), mentoring_slots(*)')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (assignmentsError) throw assignmentsError;
  // 비활성 학생의 배정은 표시/생성 대상에서 제외합니다.(비활성화 시 즉시 연결 해제와 동일한 취지)
  const assignments = (assignmentsRaw || []).filter((item) => item.students?.status !== 'inactive');

  let mentorStudentLinks = [];
  let warning = '';
  try {
    const { data: mentorStudentRows, error: mentorStudentError } = await supabase
      .from('mentoring_mentor_students')
      .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(id, mentor_name, mentor_code, capacity_target, sort_order)')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (mentorStudentError) throw mentorStudentError;
    mentorStudentLinks = (mentorStudentRows || []).filter((row) => row.students?.status !== 'inactive');
  } catch (error) {
    warning = `담당학생 설정 테이블을 아직 읽지 못했습니다. v41-31.4 SQL 실행 후 사용할 수 있습니다: ${error.message || error}`;
  }

  let assignmentConflicts = [];
  try {
    assignmentConflicts = await getExistingWeeklyAssignmentConflicts(supabase, assignments || []);
  } catch (error) {
    warning = [warning, `기존 멘토링 배정의 개인 시간표 충돌 확인 실패: ${error.message || error}`].filter(Boolean).join('\n');
  }

  const selectedDate = normalizeDateString(options.date || getKstDateString());
  let dateSchedule = { dateSlots: [], dateAssignments: [], dateAssignmentConflicts: [], dateWarning: '', dateScheduleDate: selectedDate };
  try {
    dateSchedule = await loadDateSchedule(supabase, selectedDate, {
      materialize: options.materializeDate === true,
      weeklySlots: slots || [],
      weeklyAssignments: assignments || [],
    });
  } catch (error) {
    warning = [warning, `날짜별 멘토링 일정 조회 실패: ${error.message || error}`].filter(Boolean).join('\n');
  }
  if (dateSchedule.dateWarning) warning = [warning, dateSchedule.dateWarning].filter(Boolean).join('\n');

  return {
    mentors: mentors || [],
    slots: slots || [],
    assignments: assignments || [],
    mentorStudentLinks,
    assignmentConflicts,
    ...dateSchedule,
    warning,
  };
}

async function saveMentor(supabase, body) {
  const id = body.id || body.mentorId;
  const payload = {
    mentor_code: String(body.mentorCode || body.mentor_code || `mentor-${Date.now()}`).trim(),
    mentor_name: String(body.mentorName || body.mentor_name || '').trim() || '학습멘토',
    capacity_target: Math.max(1, Number(body.capacityTarget || body.capacity_target || 13)),
    sort_order: Number(body.sortOrder || body.sort_order || 99),
    is_active: body.isActive === false || body.is_active === false ? false : true,
  };
  const query = id
    ? supabase.from('mentoring_mentors').update(payload).eq('id', id).select().single()
    : supabase.from('mentoring_mentors').insert(payload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}


async function saveMentorStudents(supabase, body) {
  const mentorId = body.mentorId || body.mentor_id;
  const studentIds = normalizeStudentIds(body);
  if (!mentorId) {
    const error = new Error('담당학생을 저장할 멘토를 선택하세요.');
    error.status = 400;
    throw error;
  }

  const { data: mentor, error: mentorError } = await supabase
    .from('mentoring_mentors')
    .select('id, mentor_name, capacity_target')
    .eq('id', mentorId)
    .maybeSingle();
  if (mentorError) throw mentorError;
  if (!mentor) {
    const error = new Error('멘토 정보를 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }

  // 저장 대상 멘토의 기존 담당 연결을 비활성화합니다.
  // 이후 선택된 학생만 다시 활성화하므로, 설정 화면의 선택 상태가 최종 기준이 됩니다.
  const { error: deactivateMentorError } = await supabase
    .from('mentoring_mentor_students')
    .update({ is_active: false })
    .eq('mentor_id', mentorId)
    .eq('is_active', true);
  if (deactivateMentorError) throw deactivateMentorError;

  if (studentIds.length) {
    // 한 학생이 여러 멘토에게 동시에 흰색 담당학생으로 보이지 않도록
    // 이번 멘토에게 저장되는 학생은 다른 멘토의 활성 담당 연결에서 제외합니다.
    const { error: deactivateOthersError } = await supabase
      .from('mentoring_mentor_students')
      .update({ is_active: false })
      .in('student_id', studentIds)
      .eq('is_active', true)
      .neq('mentor_id', mentorId);
    if (deactivateOthersError) throw deactivateOthersError;

    const rows = studentIds.map((studentId, index) => ({
      mentor_id: mentorId,
      student_id: studentId,
      sort_order: index + 1,
      is_active: true,
    }));
    const { error: upsertError } = await supabase
      .from('mentoring_mentor_students')
      .upsert(rows, { onConflict: 'mentor_id,student_id' });
    if (upsertError) throw upsertError;
  }

  return {
    id: mentorId,
    mentorId,
    mentorName: mentor.mentor_name,
    savedCount: studentIds.length,
    capacityTarget: mentor.capacity_target || 13,
  };
}

async function saveSlot(supabase, body) {
  const id = body.id || body.slotId;
  const { errors, payload } = sanitizeSlot(body);
  if (errors.length) {
    const error = new Error(errors.join('\n'));
    error.status = 400;
    throw error;
  }
  const query = id
    ? supabase.from('mentoring_slots').update(payload).eq('id', id).select().single()
    : supabase.from('mentoring_slots').insert(payload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}


async function resolveTargetSlots(supabase, sourceSlotId, repeatDays = []) {
  const { data: sourceSlot, error: slotError } = await supabase
    .from('mentoring_slots')
    .select('*')
    .eq('id', sourceSlotId)
    .single();
  if (slotError) throw slotError;

  const targetDays = repeatDays.length ? repeatDays : [Number(sourceSlot.day_of_week)];
  const slots = [];
  for (const day of targetDays) {
    if (Number(day) === Number(sourceSlot.day_of_week)) {
      slots.push(sourceSlot);
      continue;
    }
    const { data: existingRows, error: existingError } = await supabase
      .from('mentoring_slots')
      .select('*')
      .eq('day_of_week', day)
      .eq('is_active', true);
    if (existingError) throw existingError;
    const existing = (existingRows || []).find((item) => normalizeSlotLabelKey(item.slot_label) === normalizeSlotLabelKey(sourceSlot.slot_label));
    if (existing) {
      const sourceStart = normalizeSlotClock(sourceSlot.start_time);
      const sourceEnd = normalizeSlotClock(sourceSlot.end_time);
      const needsSync = normalizeSlotClock(existing.start_time) !== sourceStart || normalizeSlotClock(existing.end_time) !== sourceEnd;
      if (needsSync) {
        const { data: synced, error: syncError } = await supabase
          .from('mentoring_slots')
          .update({
            slot_label: sourceSlot.slot_label,
            start_time: sourceStart,
            end_time: sourceEnd,
            min_capacity: sourceSlot.min_capacity || existing.min_capacity || 3,
            max_capacity: sourceSlot.max_capacity || existing.max_capacity || 4,
            sort_order: day * 10000 + (timeToMinutes(sourceStart) || 0),
          })
          .eq('id', existing.id)
          .select()
          .single();
        if (syncError) throw syncError;
        slots.push(synced);
      } else {
        slots.push(existing);
      }
      continue;
    }
    const { data: inserted, error: insertError } = await supabase
      .from('mentoring_slots')
      .insert({
        day_of_week: day,
        slot_label: sourceSlot.slot_label,
        start_time: sourceSlot.start_time,
        end_time: sourceSlot.end_time,
        min_capacity: sourceSlot.min_capacity || 3,
        max_capacity: sourceSlot.max_capacity || 4,
        sort_order: day * 10000 + (timeToMinutes(sourceSlot.start_time) || 0),
        is_active: true,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    slots.push(inserted);
  }
  return slots.sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
}

async function validateAssignmentScheduleConflicts(supabase, { studentIds = [], targetSlots = [] } = {}) {
  if (!studentIds.length || !targetSlots.length) return [];
  const defaultSchedule = await getDefaultScheduleSettings(supabase);
  const today = getKstDateString();
  const dateByDay = {};
  for (const slot of targetSlots) dateByDay[Number(slot.day_of_week)] = getNextDateForDay(slot.day_of_week, today);
  const dates = Object.values(dateByDay);

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, name, school, grade, status')
    .in('id', studentIds);
  if (studentsError) throw studentsError;
  const studentMap = Object.fromEntries((students || []).map((student) => [String(student.id), student]));

  const { data: schedules, error: schedulesError } = await supabase
    .from('student_daily_schedules')
    .select('*, students(id, name, school, grade)')
    .in('student_id', studentIds)
    .in('schedule_date', dates);
  if (schedulesError) throw schedulesError;
  const scheduleMap = new Map();
  for (const schedule of schedules || []) scheduleMap.set(`${schedule.student_id}-${schedule.schedule_date}`, schedule);

  const scheduleIds = (schedules || []).map((schedule) => schedule.id).filter(Boolean);
  let breaks = [];
  if (scheduleIds.length) {
    const { data: breakRows, error: breaksError } = await supabase
      .from('student_schedule_breaks')
      .select('*')
      .in('schedule_id', scheduleIds)
      .order('leave_start', { ascending: true });
    if (breaksError) throw breaksError;
    breaks = breakRows || [];
  }
  const breaksBySchedule = {};
  for (const item of breaks) {
    if (!item.schedule_id) continue;
    if (!breaksBySchedule[item.schedule_id]) breaksBySchedule[item.schedule_id] = [];
    breaksBySchedule[item.schedule_id].push(item);
  }

  const conflicts = [];
  for (const slot of targetSlots) {
    const day = Number(slot.day_of_week);
    const date = dateByDay[day];
    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);
    if (slotStart === null || slotEnd === null) continue;

    for (const studentId of studentIds) {
      const student = studentMap[String(studentId)] || { id: studentId, name: '학생' };
      const schedule = scheduleMap.get(`${studentId}-${date}`) || {
        id: `default-${date}-${studentId}`,
        student_id: studentId,
        schedule_date: date,
        planned_check_in: defaultSchedule.plannedCheckIn,
        planned_check_out: defaultSchedule.plannedCheckOut,
        schedule_note: '기본 시간표 자동 적용',
        is_default_schedule: true,
      };
      const plannedIn = timeToMinutes(schedule.planned_check_in || defaultSchedule.plannedCheckIn);
      const plannedOut = timeToMinutes(schedule.planned_check_out || defaultSchedule.plannedCheckOut);
      const plannedRange = `${String(schedule.planned_check_in || defaultSchedule.plannedCheckIn).slice(0, 5)}~${String(schedule.planned_check_out || defaultSchedule.plannedCheckOut).slice(0, 5)}`;
      const slotTime = `${String(slot.start_time || '').slice(0, 5)}~${String(slot.end_time || '').slice(0, 5)}`;
      const base = {
        studentId,
        studentName: student.name || '학생',
        date,
        dayOfWeek: day,
        dayLabel: dayLabel(day),
        slotId: slot.id,
        slotLabel: slot.slot_label,
        slotTime,
        plannedRange,
        scheduleNote: schedule.schedule_note || null,
        isDefaultSchedule: Boolean(schedule.is_default_schedule),
      };
      if (plannedIn === null || plannedOut === null || slotStart < plannedIn || slotEnd > plannedOut) {
        conflicts.push({ ...base, reason: '멘토링 차시가 예정 학습실 체류 시간 밖입니다.' });
        continue;
      }
      const scheduleBreaks = schedule.is_default_schedule ? [] : (breaksBySchedule[schedule.id] || []);
      const overlapBreak = scheduleBreaks.find((item) => {
        const leave = timeToMinutes(item.leave_start);
        const ret = timeToMinutes(item.return_time);
        return leave !== null && ret !== null && overlaps(slotStart, slotEnd, leave, ret);
      });
      if (overlapBreak) {
        conflicts.push({
          ...base,
          reason: `등록된 외출 시간 ${String(overlapBreak.leave_start || '').slice(0, 5)}~${String(overlapBreak.return_time || '').slice(0, 5)}${overlapBreak.reason_detail ? ` (${overlapBreak.reason_detail})` : ''}과 겹칩니다.`,
        });
      }
    }
  }
  return conflicts;
}


async function saveDateSlot(supabase, body) {
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date);
  const id = body.id || body.dateSlotId || body.date_slot_id;
  const { errors, payload } = sanitizeSlot({ ...body, dayOfWeek: getKstDayOfWeek(scheduleDate) });
  if (errors.length) {
    const error = new Error(errors.join('\n'));
    error.status = 400;
    throw error;
  }
  const datePayload = {
    schedule_date: scheduleDate,
    template_slot_id: body.templateSlotId || body.template_slot_id || null,
    day_of_week: getKstDayOfWeek(scheduleDate),
    slot_label: payload.slot_label,
    start_time: payload.start_time,
    end_time: payload.end_time,
    min_capacity: payload.min_capacity,
    max_capacity: payload.max_capacity,
    sort_order: payload.sort_order,
    note: body.note || '날짜별 직접 수정',
    is_active: payload.is_active,
  };
  const query = id
    ? supabase.from('mentoring_date_slots').update(datePayload).eq('id', id).select().single()
    : supabase.from('mentoring_date_slots').insert(datePayload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function validateDateAssignmentConflicts(supabase, { studentIds = [], dateSlot = null, scheduleDate = getKstDateString() } = {}) {
  if (!studentIds.length || !dateSlot) return [];
  return getScheduleConflictsForPairs(supabase, studentIds.map((studentId) => ({
    studentId,
    slot: mapDateSlotForClient(dateSlot),
    slotId: dateSlot.id,
    dateSlotId: dateSlot.id,
    date: normalizeDateString(scheduleDate || dateSlot.schedule_date),
    scope: 'date',
  })));
}

async function validateDateAssignments(supabase, body) {
  const studentIds = normalizeStudentIds(body);
  const dateSlotId = body.dateSlotId || body.date_slot_id || body.slotId || body.slot_id;
  if (!studentIds.length || !dateSlotId) {
    const error = new Error('studentIds와 dateSlotId가 필요합니다.');
    error.status = 400;
    throw error;
  }
  const { data: dateSlot, error: dateSlotError } = await supabase.from('mentoring_date_slots').select('*').eq('id', dateSlotId).single();
  if (dateSlotError) throw dateSlotError;
  const conflicts = await validateDateAssignmentConflicts(supabase, { studentIds, dateSlot, scheduleDate: dateSlot.schedule_date });
  return { conflicts, dateSlot: mapDateSlotForClient(dateSlot) };
}


function buildProposedPersonalScheduleConflicts({ assignmentRows = [], slotById = {}, student = null, scheduleDate, plannedCheckIn, plannedCheckOut, breaks = [], scheduleNote = '' } = {}) {
  const plannedIn = timeToMinutes(plannedCheckIn);
  const plannedOut = timeToMinutes(plannedCheckOut);
  const plannedRange = `${String(plannedCheckIn || '').slice(0, 5)}~${String(plannedCheckOut || '').slice(0, 5)}`;
  const conflicts = [];
  for (const assignment of assignmentRows || []) {
    const slotId = assignment.date_slot_id || assignment.slot_id;
    const slot = assignment.mentoring_slots || assignment.mentoring_date_slots || slotById[String(slotId)] || {};
    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);
    if (slotStart === null || slotEnd === null) continue;
    const base = {
      assignmentId: assignment.template_assignment_id || assignment.id || null,
      dateAssignmentId: assignment.is_date_assignment ? assignment.id : null,
      studentId: assignment.student_id || student?.id || null,
      studentName: assignment.students?.name || student?.name || '학생',
      date: scheduleDate,
      dayOfWeek: Number(slot.day_of_week || getKstDayOfWeek(scheduleDate)),
      dayLabel: dayLabel(Number(slot.day_of_week || getKstDayOfWeek(scheduleDate))),
      slotId,
      dateSlotId: slotId,
      slotLabel: slot.slot_label || '멘토링 차시',
      slotTime: dateSlotLabel(slot),
      plannedRange,
      scheduleNote: scheduleNote || null,
      isDefaultSchedule: false,
      scope: 'personal-schedule-save',
    };
    if (plannedIn === null || plannedOut === null || slotStart < plannedIn || slotEnd > plannedOut) {
      conflicts.push({ ...base, reason: '수정하려는 개인 일정 기준으로 멘토링 차시가 예정 학습실 체류 시간 밖입니다.' });
      continue;
    }
    const overlapBreak = (breaks || []).find((item) => {
      const leave = timeToMinutes(item.leaveStart || item.leave_start);
      const ret = timeToMinutes(item.returnTime || item.return_time);
      return leave !== null && ret !== null && overlaps(slotStart, slotEnd, leave, ret);
    });
    if (overlapBreak) {
      const leaveLabel = String(overlapBreak.leaveStart || overlapBreak.leave_start || '').slice(0, 5);
      const returnLabel = String(overlapBreak.returnTime || overlapBreak.return_time || '').slice(0, 5);
      const reasonDetail = overlapBreak.reasonDetail || overlapBreak.reason_detail || overlapBreak.reason || '';
      conflicts.push({
        ...base,
        reason: `수정하려는 외출 시간 ${leaveLabel}~${returnLabel}${reasonDetail ? ` (${reasonDetail})` : ''}과 멘토링 차시가 겹칩니다.`,
      });
    }
  }
  return conflicts;
}

async function validatePersonalScheduleConflicts(supabase, body) {
  const studentId = String(body.studentId || body.student_id || '').trim();
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date);
  if (!studentId || !scheduleDate) {
    const error = new Error('studentId와 scheduleDate가 필요합니다.');
    error.status = 400;
    throw error;
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, school, grade, status')
    .eq('id', studentId)
    .maybeSingle();
  if (studentError) throw studentError;

  const dateSchedule = await loadDateSchedule(supabase, scheduleDate, { materialize: false });
  const assignmentRows = (dateSchedule.dateAssignments || []).filter((item) => String(item.student_id || item.students?.id || '') === studentId && item.is_active !== false);
  const slotById = Object.fromEntries((dateSchedule.dateSlots || []).map((slot) => [String(slot.id), slot]));
  const plannedCheckIn = String(body.plannedCheckIn || body.planned_check_in || '').slice(0, 5);
  const plannedCheckOut = String(body.plannedCheckOut || body.planned_check_out || '').slice(0, 5);
  const breaks = Array.isArray(body.breaks) ? body.breaks : [];
  const conflicts = buildProposedPersonalScheduleConflicts({
    assignmentRows,
    slotById,
    student,
    scheduleDate,
    plannedCheckIn,
    plannedCheckOut,
    breaks,
    scheduleNote: body.scheduleNote || body.schedule_note || '',
  });
  return { conflicts, scheduleDate, studentId, studentName: student?.name || '학생', mentoringAssignmentCount: assignmentRows.length };
}

async function moveDateAssignment(supabase, body) {
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date || getKstDateString());
  const targetDateSlotId = body.targetDateSlotId || body.target_date_slot_id || body.toDateSlotId || body.to_slot_id;
  const assignmentId = body.dateAssignmentId || body.date_assignment_id || body.id || body.assignmentId;
  const studentId = body.studentId || body.student_id;
  if (!targetDateSlotId || (!assignmentId && !studentId)) {
    const error = new Error('이동할 학생 배정과 목표 차시가 필요합니다.');
    error.status = 400;
    throw error;
  }

  await materializeDateSchedule(supabase, scheduleDate);

  const { data: targetSlot, error: targetSlotError } = await supabase
    .from('mentoring_date_slots')
    .select('*')
    .eq('id', targetDateSlotId)
    .eq('schedule_date', scheduleDate)
    .eq('is_active', true)
    .single();
  if (targetSlotError) throw targetSlotError;

  let assignmentQuery = supabase
    .from('mentoring_date_assignments')
    .select('*, students(id, name, school, grade, status), mentoring_mentors(*), mentoring_date_slots(*)')
    .eq('schedule_date', scheduleDate)
    .eq('is_active', true);
  if (assignmentId) assignmentQuery = assignmentQuery.eq('id', assignmentId);
  else assignmentQuery = assignmentQuery.eq('student_id', studentId);
  const { data: assignment, error: assignmentError } = await assignmentQuery.maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) {
    const error = new Error('이동할 날짜별 배정을 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요.');
    error.status = 404;
    throw error;
  }

  if (String(assignment.date_slot_id) === String(targetDateSlotId)) {
    return { moved: false, assignmentId: assignment.id, scheduleDate, targetDateSlotId };
  }

  const { count, error: countError } = await supabase
    .from('mentoring_date_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('date_slot_id', targetDateSlotId)
    .eq('is_active', true)
    .neq('id', assignment.id);
  if (countError) throw countError;
  if (Number(count || 0) >= Number(targetSlot.max_capacity || 4)) {
    const error = new Error(`${scheduleDate} ${targetSlot.slot_label}은 최대 ${targetSlot.max_capacity || 4}명까지만 배정할 수 있습니다.`);
    error.status = 400;
    throw error;
  }

  if (!body.forceScheduleConflict) {
    const conflicts = await validateDateAssignmentConflicts(supabase, {
      studentIds: [assignment.student_id],
      dateSlot: targetSlot,
      scheduleDate,
    });
    if (conflicts.length) {
      const error = new Error(`이동하려는 차시가 학생 개인 시간표와 맞지 않습니다. 확인 후 다시 이동하세요.`);
      error.status = 409;
      error.conflicts = conflicts;
      throw error;
    }
  }

  const payload = {
    date_slot_id: targetDateSlotId,
    mentor_id: body.mentorId || body.mentor_id || assignment.mentor_id,
    note: body.note || assignment.note || '드래그로 날짜별 차시 이동',
    is_active: true,
  };
  const { data, error } = await supabase
    .from('mentoring_date_assignments')
    .update(payload)
    .eq('id', assignment.id)
    .select('*, students(id, name, school, grade, status), mentoring_mentors(*), mentoring_date_slots(*)')
    .single();
  if (error) throw error;
  return { moved: true, assignmentId: assignment.id, studentId: assignment.student_id, scheduleDate, targetDateSlotId, assignment: data };
}

async function assignDateStudents(supabase, body) {
  const studentIds = normalizeStudentIds(body);
  const mentorId = body.mentorId || body.mentor_id;
  const dateSlotId = body.dateSlotId || body.date_slot_id || body.slotId || body.slot_id;
  if (!studentIds.length || !mentorId || !dateSlotId) {
    const error = new Error('studentIds, mentorId, dateSlotId가 필요합니다.');
    error.status = 400;
    throw error;
  }
  const { data: dateSlot, error: dateSlotError } = await supabase.from('mentoring_date_slots').select('*').eq('id', dateSlotId).single();
  if (dateSlotError) throw dateSlotError;
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || dateSlot.schedule_date);

  if (!body.forceScheduleConflict) {
    const conflicts = await validateDateAssignmentConflicts(supabase, { studentIds, dateSlot, scheduleDate });
    if (conflicts.length) {
      const error = new Error(`개인 시간표와 맞지 않는 날짜별 배정이 ${conflicts.length}건 있습니다. 확인 후 다시 저장하세요.`);
      error.status = 409;
      error.conflicts = conflicts;
      throw error;
    }
  }

  const { data: existingAssignments, error: existingError } = await supabase
    .from('mentoring_date_assignments')
    .select('id, student_id, date_slot_id')
    .eq('schedule_date', scheduleDate)
    .eq('is_active', true)
    .in('student_id', studentIds);
  if (existingError) throw existingError;
  const existingByStudent = new Map((existingAssignments || []).map((item) => [String(item.student_id), item]));

  const { count, error: countError } = await supabase
    .from('mentoring_date_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('date_slot_id', dateSlotId)
    .eq('is_active', true);
  if (countError) throw countError;
  let slotCount = Number(count || 0);

  const inserts = [];
  const duplicateStudents = [];
  for (const studentId of studentIds) {
    const existing = existingByStudent.get(String(studentId));
    if (existing && String(existing.date_slot_id) !== String(dateSlotId)) {
      duplicateStudents.push(studentId);
      continue;
    }
    if (existing && String(existing.date_slot_id) === String(dateSlotId)) continue;
    slotCount += 1;
    if (slotCount > Number(dateSlot.max_capacity || 4)) {
      const error = new Error(`${scheduleDate} ${dateSlot.slot_label}은 최대 ${dateSlot.max_capacity || 4}명까지만 배정할 수 있습니다.`);
      error.status = 400;
      throw error;
    }
    inserts.push({
      schedule_date: scheduleDate,
      template_assignment_id: null,
      date_slot_id: dateSlotId,
      student_id: studentId,
      mentor_id: mentorId,
      note: body.note || '날짜별 직접 배정',
      is_active: true,
    });
  }
  if (duplicateStudents.length) {
    const error = new Error(`선택한 날짜에 이미 다른 멘토링 차시가 배정된 학생이 있습니다. 기존 배정을 삭제하거나 변경한 뒤 다시 저장하세요. (${duplicateStudents.length}건)`);
    error.status = 400;
    throw error;
  }
  if (inserts.length) {
    const { error: insertError } = await supabase.from('mentoring_date_assignments').insert(inserts);
    if (insertError) throw insertError;
  }
  return { insertedCount: inserts.length, studentCount: studentIds.length, scheduleDate, dateSlotId };
}

async function deleteDateAssignment(supabase, body) {
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date || getKstDateString());
  const id = body.dateAssignmentId || body.date_assignment_id || body.id || body.assignmentId;
  const templateAssignmentId = body.templateAssignmentId || body.template_assignment_id || body.templateId || body.template_id || (!body.dateAssignmentId && !body.date_assignment_id ? body.assignmentId : null);
  const dateSlotId = body.dateSlotId || body.date_slot_id || body.slotId || body.slot_id;
  const studentId = body.studentId || body.student_id;

  // 날짜별 화면이 아직 요일 템플릿/가상 배정 ID를 들고 있어도 삭제가 먹히도록
  // 먼저 선택 날짜 일정을 실제 날짜별 일정으로 보장합니다.
  await materializeDateSchedule(supabase, scheduleDate);

  const updateDateAssignments = async (applyFilters) => {
    let query = supabase.from('mentoring_date_assignments').update({ is_active: false });
    query = applyFilters(query);
    const { data, error } = await query.select();
    if (error) throw error;
    return data || [];
  };

  let rows = [];
  if (id) rows = await updateDateAssignments((query) => query.eq('id', id));
  if (!rows.length && templateAssignmentId) {
    rows = await updateDateAssignments((query) => query
      .eq('schedule_date', scheduleDate)
      .eq('template_assignment_id', templateAssignmentId)
      .eq('is_active', true)
    );
  }
  if (!rows.length && dateSlotId && studentId) {
    rows = await updateDateAssignments((query) => query
      .eq('schedule_date', scheduleDate)
      .eq('date_slot_id', dateSlotId)
      .eq('student_id', studentId)
      .eq('is_active', true)
    );
  }
  if (!rows.length) {
    const error = new Error('삭제할 날짜별 배정을 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도하세요.');
    error.status = 404;
    throw error;
  }
  return rows[0];
}

async function deleteDateSlot(supabase, body) {
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date || getKstDateString());
  const id = body.dateSlotId || body.date_slot_id || body.id || body.slotId;
  const templateSlotId = body.templateSlotId || body.template_slot_id || (!body.dateSlotId && !body.date_slot_id ? body.slotId : null);

  // 날짜별 화면이 아직 요일 템플릿/가상 차시 ID를 들고 있어도 비활성화되도록
  // 먼저 선택 날짜 일정을 실제 날짜별 일정으로 보장합니다.
  await materializeDateSchedule(supabase, scheduleDate);

  const updateDateSlots = async (applyFilters) => {
    let query = supabase.from('mentoring_date_slots').update({ is_active: false });
    query = applyFilters(query);
    const { data, error } = await query.select();
    if (error) throw error;
    return data || [];
  };

  let rows = [];
  if (id) rows = await updateDateSlots((query) => query.eq('id', id));
  if (!rows.length && templateSlotId) {
    rows = await updateDateSlots((query) => query
      .eq('schedule_date', scheduleDate)
      .eq('template_slot_id', templateSlotId)
      .eq('is_active', true)
    );
  }
  if (!rows.length) {
    const error = new Error('비활성화할 날짜별 차시를 찾지 못했습니다. 선택 날짜 일정 수정 시작 후 다시 시도하세요.');
    error.status = 404;
    throw error;
  }
  for (const row of rows) {
    if (row.id) await supabase.from('mentoring_date_assignments').update({ is_active: false }).eq('date_slot_id', row.id);
  }
  return rows[0];
}

async function resetDateSchedule(supabase, body) {
  const scheduleDate = normalizeDateString(body.scheduleDate || body.schedule_date || body.date);
  const { error: deleteAssignmentsError } = await supabase.from('mentoring_date_assignments').delete().eq('schedule_date', scheduleDate);
  if (deleteAssignmentsError) throw deleteAssignmentsError;
  const { error: deleteSlotsError } = await supabase.from('mentoring_date_slots').delete().eq('schedule_date', scheduleDate);
  if (deleteSlotsError) throw deleteSlotsError;
  return materializeDateSchedule(supabase, scheduleDate);
}

async function assignStudents(supabase, body) {
  const studentIds = normalizeStudentIds(body);
  const mentorId = body.mentorId || body.mentor_id;
  const slotId = body.slotId || body.slot_id;
  if (!studentIds.length || !mentorId || !slotId) {
    const error = new Error('studentIds, mentorId, slotId가 필요합니다.');
    error.status = 400;
    throw error;
  }

  const { data: sourceSlot, error: sourceSlotError } = await supabase.from('mentoring_slots').select('*').eq('id', slotId).single();
  if (sourceSlotError) throw sourceSlotError;
  const repeatDays = normalizeRepeatDays(body, sourceSlot.day_of_week);
  const targetSlots = await resolveTargetSlots(supabase, slotId, repeatDays);

  if (!body.forceScheduleConflict) {
    const conflicts = await validateAssignmentScheduleConflicts(supabase, { studentIds, targetSlots });
    if (conflicts.length) {
      const error = new Error(`개인 시간표와 맞지 않는 배정이 ${conflicts.length}건 있습니다. 확인 후 다시 저장하세요.`);
      error.status = 409;
      error.conflicts = conflicts;
      throw error;
    }
  }

  const { data: existingAssignments, error: existingError } = await supabase
    .from('mentoring_assignments')
    .select('id, student_id, slot_id, mentoring_slots(day_of_week, slot_label, start_time)')
    .in('student_id', studentIds)
    .eq('is_active', true);
  if (existingError) throw existingError;
  const existingByStudentDay = new Map();
  for (const item of existingAssignments || []) {
    const key = `${item.student_id}-${Number(item.mentoring_slots?.day_of_week)}`;
    existingByStudentDay.set(key, item);
  }

  const inserts = [];
  const duplicateWarnings = [];
  const slotCounts = {};
  for (const slot of targetSlots) {
    const { count, error: countError } = await supabase
      .from('mentoring_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('slot_id', slot.id)
      .eq('is_active', true);
    if (countError) throw countError;
    slotCounts[slot.id] = Number(count || 0);
  }

  for (const slot of targetSlots) {
    for (const studentId of studentIds) {
      const existing = existingByStudentDay.get(`${studentId}-${Number(slot.day_of_week)}`);
      if (existing && String(existing.slot_id) !== String(slot.id)) {
        duplicateWarnings.push(`${studentId}:${dayLabel(slot.day_of_week)}`);
        continue;
      }
      if (existing && String(existing.slot_id) === String(slot.id)) continue;
      slotCounts[slot.id] = (slotCounts[slot.id] || 0) + 1;
      if (slotCounts[slot.id] > Number(slot.max_capacity || 4)) {
        const error = new Error(`${dayLabel(slot.day_of_week)} ${slot.slot_label}은 최대 ${slot.max_capacity || 4}명까지만 배정할 수 있습니다.`);
        error.status = 400;
        throw error;
      }
      inserts.push({
        student_id: studentId,
        mentor_id: mentorId,
        slot_id: slot.id,
        note: body.note || null,
        repeat_rule: body.repeatLabel || 'weekly',
        valid_from: body.validFrom || getKstDateString(),
        valid_to: body.validTo || null,
        is_active: true,
      });
    }
  }

  if (duplicateWarnings.length) {
    const error = new Error(`같은 요일에 이미 다른 멘토링 차시가 배정된 학생이 있습니다. 기존 배정을 삭제하거나 변경한 뒤 다시 저장하세요. (${duplicateWarnings.length}건)`);
    error.status = 400;
    throw error;
  }

  if (inserts.length) {
    const { error: insertError } = await supabase.from('mentoring_assignments').insert(inserts);
    if (insertError) throw insertError;
  }
  return { insertedCount: inserts.length, targetSlotCount: targetSlots.length, studentCount: studentIds.length, repeatDays };
}

async function validateAssignments(supabase, body) {
  const studentIds = normalizeStudentIds(body);
  const slotId = body.slotId || body.slot_id;
  if (!studentIds.length || !slotId) {
    const error = new Error('studentIds와 slotId가 필요합니다.');
    error.status = 400;
    throw error;
  }
  const { data: sourceSlot, error: sourceSlotError } = await supabase.from('mentoring_slots').select('*').eq('id', slotId).single();
  if (sourceSlotError) throw sourceSlotError;
  const repeatDays = normalizeRepeatDays(body, sourceSlot.day_of_week);
  const targetSlots = await resolveTargetSlots(supabase, slotId, repeatDays);
  const conflicts = await validateAssignmentScheduleConflicts(supabase, { studentIds, targetSlots });
  return { conflicts, targetSlots: targetSlots.map((slot) => ({ id: slot.id, day_of_week: slot.day_of_week, slot_label: slot.slot_label, start_time: slot.start_time, end_time: slot.end_time })) };
}

async function assignStudent(supabase, body) {
  const result = await assignStudents(supabase, { ...body, studentIds: [body.studentId || body.student_id].filter(Boolean), repeatDayOfWeeks: body.repeatDayOfWeeks || body.repeatDays });
  return result;
}

async function deleteAssignment(supabase, body) {
  const id = body.id || body.assignmentId;
  if (!id) {
    const error = new Error('삭제할 배정 ID가 필요합니다.');
    error.status = 400;
    throw error;
  }
  const { data, error } = await supabase
    .from('mentoring_assignments')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteSlot(supabase, body) {
  const id = body.id || body.slotId;
  if (!id) {
    const error = new Error('비활성화할 차시 ID가 필요합니다.');
    error.status = 400;
    throw error;
  }
  const { data, error } = await supabase
    .from('mentoring_slots')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await supabase.from('mentoring_assignments').update({ is_active: false }).eq('slot_id', id);
  return data;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    if (searchParams.get('seed') === '1') await seedDefaults(supabase);
    const date = normalizeDateString(searchParams.get('date') || getKstDateString());
    const materializeDate = searchParams.get('materializeDate') === '1' || searchParams.get('materialize') === '1';
    const data = await loadAll(supabase, { date, materializeDate });
    return Response.json({ ok: true, ...data });
  } catch (error) {
    return Response.json({ error: error.message || '멘토링 시간표 조회 실패' }, { status: error.status || 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const action = body.action || 'load';
    const supabase = getSupabaseAdmin();
    let result = null;
    if (action === 'seedDefaults') result = await seedDefaults(supabase);
    else if (action === 'saveMentor') result = await saveMentor(supabase, body);
    else if (action === 'saveMentorStudents') result = await saveMentorStudents(supabase, body);
    else if (action === 'saveSlot') result = await saveSlot(supabase, body);
    else if (action === 'saveDateSlot') result = await saveDateSlot(supabase, body);
    else if (action === 'materializeDateSchedule') result = await materializeDateSchedule(supabase, body.scheduleDate || body.schedule_date || body.date);
    else if (action === 'resetDateSchedule') result = await resetDateSchedule(supabase, body);
    else if (action === 'assignStudent') result = await assignStudent(supabase, body);
    else if (action === 'assignStudents') result = await assignStudents(supabase, body);
    else if (action === 'assignDateStudents') result = await assignDateStudents(supabase, body);
    else if (action === 'validateAssignments') result = await validateAssignments(supabase, body);
    else if (action === 'validateDateAssignments') result = await validateDateAssignments(supabase, body);
    else if (action === 'validatePersonalScheduleConflicts') result = await validatePersonalScheduleConflicts(supabase, body);
    else if (action === 'moveDateAssignment') result = await moveDateAssignment(supabase, body);
    else if (action === 'deleteAssignment') result = await deleteAssignment(supabase, body);
    else if (action === 'deleteDateAssignment') result = await deleteDateAssignment(supabase, body);
    else if (action === 'deleteSlot') result = await deleteSlot(supabase, body);
    else if (action === 'deleteDateSlot') result = await deleteDateSlot(supabase, body);
    else {
      return Response.json({ error: '지원하지 않는 멘토링 작업입니다.' }, { status: 400 });
    }

    await writeUserActionLog(supabase, request, {
      actionType: `mentoring.${action}`,
      targetType: 'mentoring_schedule',
      targetId: result?.id || null,
      targetName: result?.mentor_name || result?.mentorName || result?.slot_label || body.studentName || body.studentId || action,
      payload: { action, ...body, result },
    });

    const data = await loadAll(supabase, {
      date: body.scheduleDate || body.schedule_date || body.date || getKstDateString(),
      materializeDate: ['saveDateSlot', 'materializeDateSchedule', 'assignDateStudents', 'deleteDateAssignment', 'deleteDateSlot', 'validateDateAssignments', 'moveDateAssignment'].includes(action),
    });
    return Response.json({ ok: true, result, ...data });
  } catch (error) {
    return Response.json({ error: error.message || '멘토링 시간표 저장 실패', conflicts: error.conflicts || [] }, { status: error.status || 500 });
  }
}
