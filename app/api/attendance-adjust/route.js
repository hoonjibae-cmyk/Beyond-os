import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { isFiveMinuteTime24, timeToMinutes24 } from '../../../lib/defaultSchedule';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';


function validateTimeInput(label, value, { required = false } = {}) {
  if (!value) return required ? `${label}을 입력하세요.` : null;
  const minutes = timeToMinutes24(value);
  if (minutes === null || minutes >= 24 * 60 || !isFiveMinuteTime24(value)) {
    return `${label}은 5분 단위 HH:MM 형식으로 선택하세요.`;
  }
  return null;
}

function toIso(dateString, timeValue) {
  if (!dateString || !timeValue) return null;
  return new Date(`${dateString}T${timeValue}:00+09:00`).toISOString();
}

function calculatePureStudyMinutes({ checkInAt, checkOutAt, awayTotalMinutes, awayStartedAt, studyWindows }) {
  return calculateScheduledPureStudyMinutes({
    check_in_at: checkInAt,
    check_out_at: checkOutAt,
    away_total_minutes: awayTotalMinutes,
    away_started_at: awayStartedAt,
  }, { studyWindows });
}

async function resolveSession(supabase, body) {
  if (body.sessionId && !body.sessionDate) {
    const { data, error } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('id', body.sessionId)
      .single();

    if (error) throw error;
    return data;
  }

  let baseSession = null;

  if (body.sessionId) {
    const { data, error } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('id', body.sessionId)
      .single();

    if (error) throw error;
    baseSession = data;
  }

  const sessionDate = body.sessionDate || baseSession?.session_date || getKstDateString();
  const studentId = body.studentId || baseSession?.student_id;
  const seatNo = Number(body.seatNo || baseSession?.seat_no || 0);

  if (!studentId || !seatNo) {
    throw new Error('studentId and seatNo are required to adjust a different date.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', studentId)
    .eq('session_date', sessionDate)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('daily_sessions')
    .insert({
      student_id: studentId,
      seat_no: seatNo,
      session_date: sessionDate,
      seat_status: 'out',
      current_study_status: null,
      current_subject: null,
    })
    .select()
    .single();

  if (createError) throw createError;
  return created;
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    if (!body.sessionId && !body.studentId) {
      return Response.json({ error: 'sessionId or studentId is required' }, { status: 400 });
    }

    const checkErrors = [
      validateTimeInput('입실 시간', body.checkInTime, { required: true }),
      validateTimeInput('퇴실 시간', body.checkOutTime),
    ].filter(Boolean);
    if (checkErrors.length) {
      return Response.json({ error: checkErrors.join(' / ') }, { status: 400 });
    }

    const session = await resolveSession(supabase, body);
    const targetDate = body.sessionDate || session.session_date;
    const defaultSchedule = await getDefaultScheduleSettings(supabase, targetDate);

    const checkInAt = toIso(targetDate, body.checkInTime);
    const checkOutAt = body.checkOutTime ? toIso(targetDate, body.checkOutTime) : null;
    const awayTotalMinutes = Math.max(0, Number(body.awayTotalMinutes || 0));

    const pureStudyMinutes = calculatePureStudyMinutes({
      checkInAt,
      checkOutAt,
      awayTotalMinutes,
      awayStartedAt: session.away_started_at,
      studyWindows: defaultSchedule.studyWindows,
    });

    const desiredSeatStatus = body.desiredSeatStatus || null;
    const nextSeatStatus = desiredSeatStatus || (checkOutAt ? 'out' : (checkInAt ? 'occupied' : session.seat_status));

    const { data: saved, error: updateError } = await supabase
      .from('daily_sessions')
      .update({
        check_in_at: checkInAt,
        check_out_at: checkOutAt,
        away_total_minutes: awayTotalMinutes,
        pure_study_minutes: pureStudyMinutes,
        pure_study_manual_text: null,
        seat_status: nextSeatStatus,
      })
      .eq('id', session.id)
      .select('*, students(*)')
      .single();

    if (updateError) throw updateError;

    const attendanceNotifications = [];
    const adminName = body.adminName || '관리자';

    async function insertManualAttendanceEvent(eventType, eventAt, memo) {
      const { data: eventRow, error: eventError } = await supabase.from('attendance_events').insert({
        session_id: session.id,
        student_id: session.student_id,
        seat_no: session.seat_no,
        event_type: eventType,
        event_at: eventAt,
        memo,
        created_by: adminName,
        source_type: 'manual',
        source_label: '관리자 수동기록',
      }).select().single();
      if (eventError) throw eventError;

      try {
        const notification = await sendAttendanceNotification({
          supabase,
          request,
          attendanceEvent: eventRow,
          session: saved,
          student: saved.students || null,
          sourceType: 'manual',
          sourceLabel: '관리자 수동기록',
          createdBy: adminName,
        });
        attendanceNotifications.push({ eventType, notification });
      } catch (notificationError) {
        attendanceNotifications.push({ eventType, notification: { ok: false, error: notificationError.message || '출결 자동 알림 처리 실패' } });
      }

      return eventRow;
    }

    // 출결시간 조정 화면에서 새 입실/퇴실 시간이 처음 잡히는 경우만 알림 대상으로 처리합니다.
    // 기존 시간이 단순 수정되는 경우는 중복/오발송을 막기 위해 manual_edit 기록만 남깁니다.
    if (!session.check_in_at && checkInAt) {
      await insertManualAttendanceEvent('check_in', checkInAt, body.note || `관리자 입실시간 수동 입력(${targetDate})`);
    }

    if (!session.check_out_at && checkOutAt) {
      await insertManualAttendanceEvent('check_out', checkOutAt, body.note || `관리자 퇴실시간 수동 입력(${targetDate})`);
    }

    await supabase.from('attendance_events').insert({
      session_id: session.id,
      student_id: session.student_id,
      seat_no: session.seat_no,
      event_type: 'manual_edit',
      memo: body.note || `관리자 출결시간 조정(${targetDate})`,
      created_by: adminName,
      source_type: 'manual',
      source_label: '관리자 수동기록',
    });

    return Response.json({ session: saved, attendanceNotifications });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
