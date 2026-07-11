import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';

const STATUS_MAP = {
  not_arrived: 'not_arrived',
  occupied: 'occupied',
  away: 'away',
  out: 'out',
  absent: 'absent',
  warning: 'needs_attention',
  needs_attention: 'needs_attention',
};

const EVENT_MAP = {
  occupied: 'check_in',
  away: 'away',
  out: 'check_out',
  absent: 'absent',
  warning: 'needs_attention',
  needs_attention: 'needs_attention',
};

function parseStudyMinutes(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const h = raw.match(/(\d+)\s*시간/);
  const m = raw.match(/(\d+)\s*분/);
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? total : null;
}

async function upsertStudent(supabase, student, seatNo) {
  const payload = {
    name: student.name,
    school: student.school || null,
    grade: student.grade || null,
    parent_phone: student.parentPhone || null,
    student_phone: student.studentPhone || null,
    default_seat_no: seatNo,
    status: 'active',
  };

  if (student.id) {
    const { data, error } = await supabase.from('students').update(payload).eq('id', student.id).select().single();
    if (error) throw error;
    return data;
  }

  const { data: seat } = await supabase.from('seats').select('current_student_id').eq('seat_no', seatNo).maybeSingle();

  const excludeStudentId = student.id || seat?.current_student_id || '00000000-0000-0000-0000-000000000000';
  const { data: duplicateNameStudents, error: duplicateNameError } = await supabase
    .from('students')
    .select('id,name,status,school,grade')
    .eq('name', student.name)
    .neq('id', excludeStudentId)
    .neq('status', 'inactive');

  if (duplicateNameError) throw duplicateNameError;

  if ((duplicateNameStudents || []).length) {
    throw new Error(`이미 같은 이름의 활성 학생이 있습니다: ${student.name}. 동명이인 학생은 키오스크 자동 출결 매칭을 위해 이름 뒤에 구분표시를 붙여 저장하세요. 예: ${student.name}A, ${student.name}①, ${student.name}(중1)`);
  }

  if (seat?.current_student_id) {
    const { data, error } = await supabase.from('students').update(payload).eq('id', seat.current_student_id).select().single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from('students').insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateLastEventType(supabase, sessionId, fromType, toType, memo) {
  if (!sessionId) return;

  const { data: rows, error } = await supabase
    .from('attendance_events')
    .select('id')
    .eq('session_id', sessionId)
    .eq('event_type', fromType)
    .order('event_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const targetId = rows?.[0]?.id;
  if (!targetId) return;

  const { error: updateError } = await supabase
    .from('attendance_events')
    .update({
      event_type: toType,
      memo: memo || '퇴실 기록을 외출 기록으로 전환',
    })
    .eq('id', targetId);

  if (updateError) throw updateError;
}

async function deleteEventsForSession(supabase, sessionId) {
  if (!sessionId) return;
  const { error } = await supabase.from('attendance_events').delete().eq('session_id', sessionId);
  if (error) throw error;
}

async function deleteAbsentEvents(supabase, sessionId) {
  if (!sessionId) return;
  const { error } = await supabase
    .from('attendance_events')
    .delete()
    .eq('session_id', sessionId)
    .eq('event_type', 'absent');

  if (error) throw error;
}

function calculatePureStudyMinutes({ checkInAt, checkOutAt, awayStartedAt, awayTotalMinutes, nowIso, studyWindows }) {
  return calculateScheduledPureStudyMinutes({
    check_in_at: checkInAt,
    check_out_at: checkOutAt,
    away_started_at: awayStartedAt,
    away_total_minutes: awayTotalMinutes,
  }, { nowIso, studyWindows });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const defaultSchedule = await getDefaultScheduleSettings(supabase);
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';
    const today = getKstDateString();

    const seatNo = Number(body.seatNo);
    const student = body.student || {};
    const seatStatus = STATUS_MAP[body.seatStatus] || 'not_arrived';
    const transitionAction = body.transitionAction || '';
    const hasAttendanceMemo = Object.prototype.hasOwnProperty.call(body, 'attendanceMemo');

    if (!seatNo || seatNo < 1 || seatNo > 26) {
      return Response.json({ error: 'seatNo must be 1-26' }, { status: 400 });
    }
    if (!student.name || !student.name.trim()) {
      return Response.json({ error: '학생명을 입력하세요.' }, { status: 400 });
    }

    const savedStudent = await upsertStudent(supabase, { ...student, name: student.name.trim() }, seatNo);

    await supabase.from('seats').update({ current_student_id: savedStudent.id }).eq('seat_no', seatNo);

    const { data: existingSession, error: existingError } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('student_id', savedStudent.id)
      .eq('session_date', today)
      .maybeSingle();

    if (existingError) throw existingError;

    const nowIso = body.eventTime ? new Date(body.eventTime).toISOString() : new Date().toISOString();
    let awayTotalMinutes = Number(existingSession?.away_total_minutes || 0);
    let awayStartedAt = existingSession?.away_started_at || null;
    let checkInAt = existingSession?.check_in_at || null;
    let checkOutAt = existingSession?.check_out_at || null;

    let forcedEventType = null;
    let suppressGenericEvent = false;
    let deleteAllEventsBeforeInsert = false;
    let deleteAbsentBeforeInsert = false;
    let convertLastCheckoutToAway = false;
    let lastCheckoutMemo = body.attendanceMemo || '퇴실 기록을 외출 기록으로 전환';
    let eventMemoOverride = null;

    if (transitionAction === 'reset_to_absent') {
      checkInAt = null;
      checkOutAt = null;
      awayStartedAt = null;
      awayTotalMinutes = 0;
      forcedEventType = 'absent';
      deleteAllEventsBeforeInsert = true;
    }

    if (transitionAction === 'absent_to_occupied' || transitionAction === 'absent_to_manual_checkin') {
      deleteAbsentBeforeInsert = true;
      if (transitionAction === 'absent_to_manual_checkin') {
        checkInAt = null;
        checkOutAt = null;
        awayStartedAt = null;
        awayTotalMinutes = 0;
      }
    }

    if (transitionAction === 'out_to_away') {
      awayStartedAt = nowIso || checkOutAt || new Date().toISOString();
      checkOutAt = null;
      convertLastCheckoutToAway = Boolean(existingSession?.id);
      suppressGenericEvent = true;
    }

    if (transitionAction === 'reentry_from_out') {
      const previousCheckout = checkOutAt;
      if (!checkInAt) checkInAt = nowIso;
      if (previousCheckout) {
        awayTotalMinutes += diffMinutes(previousCheckout, nowIso);
        checkOutAt = null;
        awayStartedAt = null;
        convertLastCheckoutToAway = Boolean(existingSession?.id);
        lastCheckoutMemo = '퇴실 후 재입실로 외출 처리';
      }
      forcedEventType = 'return';
      eventMemoOverride = '퇴실 후 재입실 처리';
    }

    const returningFromAway = seatStatus === 'occupied' && Boolean(awayStartedAt) && transitionAction !== 'reentry_from_out';

    if (seatStatus === 'occupied') {
      if (!checkInAt) checkInAt = nowIso;
      if (awayStartedAt) {
        awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
        awayStartedAt = null;
      }
      if (transitionAction === 'absent_to_occupied') {
        checkOutAt = null;
        awayStartedAt = null;
        awayTotalMinutes = 0;
      }
    }

    if (seatStatus === 'away') {
      if (!awayStartedAt) awayStartedAt = nowIso;
      if (transitionAction === 'out_to_away') checkOutAt = null;
    }

    if (seatStatus === 'out') {
      checkOutAt = nowIso;
      if (awayStartedAt) {
        awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
        awayStartedAt = null;
      }
    }

    let pureStudyMinutes = calculatePureStudyMinutes({
      checkInAt,
      checkOutAt,
      awayStartedAt,
      awayTotalMinutes,
      nowIso,
      studyWindows: defaultSchedule.studyWindows,
    });

    if (seatStatus === 'absent') pureStudyMinutes = 0;

    const sessionPayload = {
      student_id: savedStudent.id,
      seat_no: seatNo,
      session_date: today,
      seat_status: seatStatus,
      check_in_at: checkInAt,
      check_out_at: checkOutAt,
      away_started_at: awayStartedAt,
      away_total_minutes: awayTotalMinutes,
      pure_study_minutes: pureStudyMinutes,
      pure_study_manual_text: null,
      attendance_memo: hasAttendanceMemo
        ? (String(body.attendanceMemo || '').trim() || null)
        : (transitionAction === 'reset_to_absent' ? null : (existingSession?.attendance_memo || null)),
      current_study_status: Object.prototype.hasOwnProperty.call(body, 'studyStatus') ? (body.studyStatus || null) : (existingSession?.current_study_status || null),
      current_subject: Object.prototype.hasOwnProperty.call(body, 'subject') ? (body.subject || null) : (existingSession?.current_subject || null),
    };

    const { data: savedSession, error: sessionError } = await supabase
      .from('daily_sessions')
      .upsert(sessionPayload, { onConflict: 'student_id,session_date' })
      .select('*, students(*)')
      .single();

    if (sessionError) throw sessionError;

    if (deleteAllEventsBeforeInsert) await deleteEventsForSession(supabase, savedSession.id);
    if (deleteAbsentBeforeInsert) await deleteAbsentEvents(supabase, savedSession.id);
    if (convertLastCheckoutToAway) await updateLastEventType(supabase, savedSession.id, 'check_out', 'away', lastCheckoutMemo);

    const eventType = forcedEventType || (returningFromAway ? 'return' : EVENT_MAP[body.seatStatus]);
    let savedAttendanceEvent = null;
    let attendanceNotificationResult = null;
    if (!suppressGenericEvent && eventType) {
      const { data: eventRow, error: eventError } = await supabase.from('attendance_events').insert({
        session_id: savedSession.id,
        student_id: savedStudent.id,
        seat_no: seatNo,
        event_type: eventType,
        event_at: nowIso,
        memo: eventMemoOverride || body.attendanceMemo || null,
        created_by: actorName,
        source_type: 'manual',
        source_label: '관리자 수동기록',
      }).select().single();
      if (eventError) throw eventError;
      savedAttendanceEvent = eventRow;

      try {
        attendanceNotificationResult = await sendAttendanceNotification({
          supabase,
          request,
          attendanceEvent: savedAttendanceEvent,
          session: savedSession,
          student: savedStudent,
          sourceType: 'manual',
          sourceLabel: '관리자 수동기록',
          createdBy: actorName,
        });
      } catch (notificationError) {
        attendanceNotificationResult = { ok: false, error: notificationError.message || '출결 자동 알림 처리 실패' };
      }
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'attendance.status',
      targetType: 'daily_session',
      targetId: savedSession.id,
      targetName: savedStudent.name,
      payload: {
        studentId: savedStudent.id,
        seatNo,
        seatStatus,
        eventType,
        transitionAction,
        eventTime: nowIso,
        attendanceNotification: attendanceNotificationResult ? {
          ok: attendanceNotificationResult.ok,
          skipped: attendanceNotificationResult.skipped || false,
          status: attendanceNotificationResult.status || null,
          reason: attendanceNotificationResult.reason || null,
          logId: attendanceNotificationResult.log?.id || null,
        } : null,
      },
    });

    return Response.json({ session: savedSession, student: savedStudent, attendanceEvent: savedAttendanceEvent, attendanceNotification: attendanceNotificationResult });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
