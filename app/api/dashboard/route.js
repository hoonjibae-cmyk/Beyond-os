import { getSupabaseAdmin, getSupabaseEnv } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';
import { STATIC_SEATS } from '../../../lib/staticSeats';

export const dynamic = 'force-dynamic';

function safeError(error) {
  return error?.message || String(error || 'Unknown error');
}

function getKstDayOfWeek(dateString = getKstDateString()) {
  return new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
}

function isAssignmentActiveOnDate(item = {}, dateString = getKstDateString()) {
  const start = item.valid_from || item.start_date;
  const end = item.valid_to || item.end_date;
  if (start && String(start).slice(0, 10) > dateString) return false;
  if (end && String(end).slice(0, 10) < dateString) return false;
  return item.is_active !== false;
}

function normalizeSlotClock(value) {
  return String(value || '').slice(0, 5);
}

function isAutoTemplateDateSlot(slot = {}) {
  if (!slot.template_slot_id) return false;
  const note = String(slot.note || '');
  return !note || note.includes('요일 템플릿 자동 반영') || note.includes('요일 기본값');
}

async function attachCurrentStudents(supabase, seats) {
  const ids = [...new Set((seats || []).map((s) => s.current_student_id).filter(Boolean))];
  if (!ids.length) return seats || [];

  const { data: students, error } = await supabase
    .from('students')
    .select('*, student_guardians(*)')
    .in('id', ids);

  if (error) return seats || [];

  const studentMap = {};
  for (const student of students || []) studentMap[student.id] = student;

  return (seats || []).map((seat) => ({
    ...seat,
    current_student: seat.current_student_id ? studentMap[seat.current_student_id] || null : null,
  }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const today = getKstDateString();
  let supabase;

  try {
    getSupabaseEnv();
    supabase = getSupabaseAdmin();
  } catch (error) {
    return Response.json({
      ok: false,
      today,
      seats: STATIC_SEATS,
      students: [],
      sessions: [],
      checks: [],
      events: [],
      reports: [],
      kioskImportEvents: [],
      fieldFocusAcknowledgements: [],
      todayMentoringAssignments: [],
      warning: `Supabase 환경변수 오류: ${safeError(error)}`,
    });
  }

  try {
    const { data: seatsRaw, error: seatsError } = await supabase
      .from('seats')
      .select('*')
      .eq('is_active', true)
      .order('seat_no', { ascending: true });

    if (seatsError) {
      return Response.json({
        ok: false,
        today,
        seats: STATIC_SEATS,
        students: [],
        sessions: [],
        checks: [],
        events: [],
        reports: [],
        fieldFocusAcknowledgements: [],
        todayMentoringAssignments: [],
        warning: `좌석 DB 조회 실패. 임시 좌석을 표시합니다: ${seatsError.message}`,
      });
    }

    const seats = await attachCurrentStudents(supabase, seatsRaw?.length ? seatsRaw : STATIC_SEATS);

    const { data: allStudents, error: studentsError } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('status', 'active')
      .order('name', { ascending: true });

    const { data: sessions, error: sessionsError } = await supabase
      .from('daily_sessions')
      .select('*, students(*, student_guardians(*))')
      .eq('session_date', today);

    if (sessionsError) {
      return Response.json({
        ok: false,
        today,
        seats,
        students: allStudents || [],
        sessions: [],
        checks: [],
        events: [],
        reports: [],
        fieldFocusAcknowledgements: [],
        todayMentoringAssignments: [],
        warning: `오늘 세션 조회 실패. 좌석만 표시합니다: ${sessionsError.message}`,
      });
    }

    const sessionIds = (sessions || []).map((s) => s.id);
    let checks = [];
    let events = [];
    let reports = [];
    let kioskImportEvents = [];
    let fieldFocusAcknowledgements = [];
    let todayMentoringAssignments = [];

    if (sessionIds.length > 0) {
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

    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: importRows, error: importError } = await supabase
        .from('attendance_import_events')
        .select('*')
        .gte('received_at', since)
        .order('received_at', { ascending: false })
        .limit(20);
      if (!importError) kioskImportEvents = importRows || [];
    } catch {
      kioskImportEvents = [];
    }

    try {
      const { data: focusAckRows, error: focusAckError } = await supabase
        .from('field_focus_acknowledgements')
        .select('*')
        .eq('ack_date', today)
        .eq('is_active', true)
        .order('dismissed_at', { ascending: false });
      if (!focusAckError) fieldFocusAcknowledgements = focusAckRows || [];
    } catch {
      fieldFocusAcknowledgements = [];
    }



    try {
      let usedDateSpecificSchedule = false;

      // v41-33: 날짜별로 수정된 멘토링 일정이 있으면 오늘 좌석배치도 파란색 표시도 날짜별 일정을 우선합니다.
      try {
        const { data: dateSlots, error: dateSlotsError } = await supabase
          .from('mentoring_date_slots')
          .select('*')
          .eq('schedule_date', today)
          .eq('is_active', true);

        if (!dateSlotsError && (dateSlots || []).length) {
          let effectiveDateSlots = dateSlots || [];
          const templateSlotIds = [...new Set(effectiveDateSlots.map((slot) => slot.template_slot_id).filter(Boolean).map(String))];
          if (templateSlotIds.length) {
            const { data: templateSlots, error: templateSlotsError } = await supabase
              .from('mentoring_slots')
              .select('*')
              .in('id', templateSlotIds);
            if (!templateSlotsError) {
              const templateMap = Object.fromEntries((templateSlots || []).map((slot) => [String(slot.id), slot]));
              effectiveDateSlots = effectiveDateSlots.map((slot) => {
                const template = templateMap[String(slot.template_slot_id)];
                if (!template || template.is_active === false || !isAutoTemplateDateSlot(slot)) return slot;
                return {
                  ...slot,
                  day_of_week: template.day_of_week || slot.day_of_week,
                  slot_label: template.slot_label || slot.slot_label,
                  start_time: normalizeSlotClock(template.start_time) || slot.start_time,
                  end_time: normalizeSlotClock(template.end_time) || slot.end_time,
                  min_capacity: template.min_capacity || slot.min_capacity,
                  max_capacity: template.max_capacity || slot.max_capacity,
                  sort_order: template.sort_order || slot.sort_order,
                };
              });
            }
          }
          const dateSlotMap = Object.fromEntries(effectiveDateSlots.map((slot) => [String(slot.id), slot]));
          const { data: dateRows, error: dateRowsError } = await supabase
            .from('mentoring_date_assignments')
            .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(*)')
            .eq('schedule_date', today)
            .eq('is_active', true)
            .in('date_slot_id', Object.keys(dateSlotMap));

          if (!dateRowsError) {
            todayMentoringAssignments = (dateRows || [])
              .map((item) => ({
                ...item,
                slot_id: item.date_slot_id,
                mentoring_slots: dateSlotMap[String(item.date_slot_id)] || null,
                is_date_assignment: true,
              }))
              .filter((item) => item.mentoring_slots);
            usedDateSpecificSchedule = true;
          }
        }
      } catch {
        usedDateSpecificSchedule = false;
      }

      if (!usedDateSpecificSchedule) {
        const kstDay = getKstDayOfWeek(today);

        // v41-31.2: 좌석배치도 멘토링 예정 표시가 누락되지 않도록
        // 오늘 요일의 활성 차시를 먼저 조회한 뒤 배정값에 수동으로 slot 정보를 붙입니다.
        // Supabase nested select 관계명이 환경에 따라 흔들려도 dashboard cue가 비는 것을 방지합니다.
        const { data: todaySlots, error: todaySlotsError } = await supabase
          .from('mentoring_slots')
          .select('*')
          .eq('is_active', true)
          .eq('day_of_week', kstDay);

        if (!todaySlotsError && (todaySlots || []).length) {
          const slotMap = Object.fromEntries((todaySlots || []).map((slot) => [String(slot.id), slot]));
          const { data: mentoringRows, error: mentoringError } = await supabase
            .from('mentoring_assignments')
            .select('*, students(id, name, school, grade, default_seat_no, status), mentoring_mentors(*)')
            .eq('is_active', true)
            .in('slot_id', Object.keys(slotMap));

          if (!mentoringError) {
            todayMentoringAssignments = (mentoringRows || [])
              .map((item) => ({ ...item, mentoring_slots: slotMap[String(item.slot_id)] || null }))
              .filter((item) => item.mentoring_slots)
              .filter((item) => isAssignmentActiveOnDate(item, today));
          }
        }
      }
    } catch {
      todayMentoringAssignments = [];
    }

    return Response.json({
      ok: true,
      today,
      seats,
      students: allStudents || [],
      sessions: sessions || [],
      checks,
      events,
      reports,
      kioskImportEvents,
      fieldFocusAcknowledgements,
      todayMentoringAssignments,
      warning: studentsError ? `학생 목록 조회 일부 실패: ${studentsError.message}` : undefined,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      today,
      seats: STATIC_SEATS,
      students: [],
      sessions: [],
      checks: [],
      events: [],
      reports: [],
      kioskImportEvents: [],
      fieldFocusAcknowledgements: [],
      todayMentoringAssignments: [],
      warning: `대시보드 로딩 중 예외 발생. 임시 좌석을 표시합니다: ${safeError(error)}`,
    });
  }
}
