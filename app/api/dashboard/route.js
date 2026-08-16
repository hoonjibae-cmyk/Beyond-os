import { getSupabaseAdmin, getSupabaseEnv } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';
import { STATIC_SEATS } from '../../../lib/staticSeats';
import { MENTORING_POLICY_SETTING_KEY, getMentoringPolicyCohortKey, normalizeMentoringPolicy, FALLBACK_MENTORING_POLICY } from '../../../lib/mentoringPolicy';

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

    let { data: sessions, error: sessionsError } = await supabase
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

    // v41-187: 기수 정보는 결석 세션 보정과 멘토링 운영 기준 양쪽에서 씁니다.
    let cohortRows = [];
    let todayCohort = null;
    try {
      const { data } = await supabase
        .from('cohorts').select('id, name, start_date, end_date').order('start_date', { ascending: true });
      cohortRows = data || [];
      // 기간이 겹치면 나중에 시작한 기수를 씁니다.
      todayCohort = [...cohortRows].reverse().find((row) => (
        String(row.start_date || '').slice(0, 10) <= today && today <= String(row.end_date || '').slice(0, 10)
      )) || null;
    } catch {
      cohortRows = [];
      todayCohort = null;
    }

    // 예약결석 세션 정합성 자동 보정 (v41-119 → v41-187 확장)
    //
    // '[예약결석]' 세션은 개인 시간표의 planned_absent 를 근거로 자동 생성됩니다.
    // 근거가 사라졌는데 세션만 남으면 좌석배치도에 결석으로 계속 뜹니다.
    // v41-119 는 '오늘 시간표가 명시적으로 결석 아님'인 경우만 지웠습니다.
    // 그래서 기수가 끝나 오늘 시간표 자체가 없어진 학생은 계속 결석으로 남았습니다.
    //
    // 이제 다음 경우를 모두 정리합니다.
    //   · 오늘 개인 시간표가 결석이 아님
    //   · 오늘 개인 시간표가 아예 없음 (시간표를 지웠거나 기수가 끝난 경우)
    //   · 오늘이 어느 기수 기간에도 속하지 않음 (기수 사이 공백일)
    //   · 오늘 기수 명단에 없는 학생임
    // 관리자가 손으로 결석 처리한 세션은 메모가 달라 건드리지 않습니다.
    try {
      const staleAbsent = (sessions || []).filter((s) => s.seat_status === 'absent'
        && !s.check_in_at
        && String(s.attendance_memo || '').startsWith('[예약결석]'));
      if (staleAbsent.length) {
        const studentIds = [...new Set(staleAbsent.map((s) => s.student_id).filter(Boolean))];
        const { data: scheduleRows, error: scheduleError } = await supabase
          .from('student_daily_schedules')
          .select('student_id, planned_absent')
          .eq('schedule_date', today)
          .in('student_id', studentIds);
        // 시간표 조회에 실패하면 근거를 알 수 없으므로 아무것도 지우지 않습니다.
        if (scheduleError) throw scheduleError;

        const absentByStudent = {};
        for (const row of scheduleRows || []) absentByStudent[String(row.student_id)] = Boolean(row.planned_absent);

        // 오늘 기수 명단 (기수를 쓰지 않는 환경이면 null → 명단 조건 미적용)
        let todayRoster = null;
        if (cohortRows.length && todayCohort) {
          const { data: rosterRows, error: rosterError } = await supabase
            .from('cohort_students')
            .select('student_id')
            .eq('cohort_id', todayCohort.id)
            .eq('is_active', true);
          if (!rosterError && (rosterRows || []).length) {
            todayRoster = new Set((rosterRows || []).map((row) => String(row.student_id)));
          }
        }

        const removeIds = staleAbsent.filter((session) => {
          const studentId = String(session.student_id || '');
          if (absentByStudent[studentId] !== true) return true;       // 결석 근거가 없음
          if (cohortRows.length && !todayCohort) return true;          // 오늘은 어느 기수도 아님
          if (todayRoster && !todayRoster.has(studentId)) return true; // 오늘 기수 명단 밖
          return false;
        }).map((session) => session.id);

        if (removeIds.length) {
          await supabase.from('daily_sessions').delete().in('id', removeIds);
          const removeSet = new Set(removeIds);
          sessions = (sessions || []).filter((s) => !removeSet.has(s.id));
        }
      }
    } catch {
      // 보정 실패는 대시보드 표시를 막지 않습니다.
    }

    const sessionIds = (sessions || []).map((s) => s.id);
    let checks = [];
    let events = [];
    let reports = [];
    let kioskImportEvents = [];
    let fieldFocusAcknowledgements = [];
    let todayMentoringAssignments = [];
    // v41-179: 좌석표 멘토링 안내 시작 시점 등에 쓰는 운영 기준.
    // 오늘이 속한 기수에 전용 설정이 있으면 그것을, 없으면 공통을 씁니다.
    let mentoringPolicy = normalizeMentoringPolicy(FALLBACK_MENTORING_POLICY);
    try {
      // v41-187: 위에서 이미 읽어 둔 기수를 그대로 씁니다.
      const keys = [MENTORING_POLICY_SETTING_KEY];
      if (todayCohort) keys.push(getMentoringPolicyCohortKey(todayCohort.id));
      const { data: policyRows } = await supabase
        .from('system_settings').select('setting_key, setting_value').in('setting_key', keys);
      const cohortRow = todayCohort
        ? (policyRows || []).find((row) => row.setting_key === getMentoringPolicyCohortKey(todayCohort.id))
        : null;
      const globalRow = (policyRows || []).find((row) => row.setting_key === MENTORING_POLICY_SETTING_KEY);
      mentoringPolicy = normalizeMentoringPolicy(cohortRow?.setting_value || globalRow?.setting_value || FALLBACK_MENTORING_POLICY);
    } catch {
      // 설정을 못 읽어도 기본값으로 계속 진행합니다.
    }

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

    // v41-145: 오늘 나간 학부모 확인 요청 알림 내역.
    // 여러 직원이 각자 화면을 보고 있어도 "이미 누가 보냈는지"를 모두가 알 수 있어야
    // 같은 학부모에게 중복 발송하는 일을 막을 수 있습니다.
    let parentAlertLogs = [];
    try {
      const { data: alertLogs } = await supabase
        .from('parent_notification_logs')
        .select('id, student_id, schedule_id, break_id, notification_type, send_status, created_by, created_at')
        .gte('created_at', `${today}T00:00:00+09:00`)
        .lte('created_at', `${today}T23:59:59+09:00`)
        .order('created_at', { ascending: false });
      // 초안 저장과 실패 건은 "발송됨"으로 보지 않습니다.
      parentAlertLogs = (alertLogs || []).filter((row) => !['draft', 'failed'].includes(String(row.send_status || '')));
    } catch {
      parentAlertLogs = [];
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
      mentoringPolicy,
      parentAlertLogs,
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
