// Beyond OS v41-255 — [최근 출결 이력] 한 줄의 시각 수정
//
// 이벤트를 하루의 원본으로 보고, 고친 뒤 daily_sessions 의 입실/퇴실/외출누적/
// 순공시간을 이벤트에서 다시 만들어 맞춥니다. 그래서 [오늘 출결 요약]과
// [최근 출결 이력]의 숫자가 갈라지지 않습니다.
//
// 저장 전에 결과를 미리 계산해 경고를 돌려줍니다. 경고가 있으면 confirm:true 로
// 다시 보내야 저장합니다. (사람이 화면에서 확인한 뒤에만 반영됩니다)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getClosingOffsetMinutes } from '../../../lib/businessDateServer';
import { getDayBoundaryMinutes } from '../../../lib/businessDate';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import {
  parseTimeOfDay,
  resolveEventIso,
  planAttendanceEventTimeChange,
  getEventTypeLabel,
} from '../../../lib/attendanceEventTime';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const eventId = String(body.eventId || '').trim();
    const timeInput = String(body.time || '').trim();
    const confirmed = body.confirm === true;

    if (!eventId) return Response.json({ error: 'eventId is required' }, { status: 400 });

    const minuteOfDay = parseTimeOfDay(timeInput);
    if (minuteOfDay === null) {
      return Response.json({ error: '시각을 HH:MM 형식으로 입력하세요. (예: 19:20)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const { data: event, error: eventError } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('id', eventId)
      .single();
    if (eventError) throw eventError;
    if (!event?.session_id) {
      return Response.json({ error: '이 기록은 출결 세션에 연결되어 있지 않아 시각을 고칠 수 없습니다.' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('id', event.session_id)
      .single();
    if (sessionError) throw sessionError;

    const { data: events, error: eventsError } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('session_id', event.session_id);
    if (eventsError) throw eventsError;

    const closingOffsetMinutes = await getClosingOffsetMinutes(supabase);
    const boundaryMinutes = getDayBoundaryMinutes(closingOffsetMinutes);
    const defaultSchedule = await getDefaultScheduleSettings(supabase, session.session_date);

    const newIso = resolveEventIso(session.session_date, minuteOfDay, boundaryMinutes);

    const plan = planAttendanceEventTimeChange({
      event,
      session,
      events: events || [],
      newIso,
      studyWindows: defaultSchedule.studyWindows,
    });

    if (!plan.ok || plan.blocked.length) {
      return Response.json({ error: plan.blocked.join(' / ') || '이 기록은 시각을 고칠 수 없습니다.' }, { status: 400 });
    }

    if (plan.before.iso === newIso) {
      return Response.json({ ok: true, unchanged: true, message: '시각이 같아 변경하지 않았습니다.' });
    }

    // 경고가 있으면 확인을 받기 전에는 저장하지 않습니다.
    if (plan.warnings.length && !confirmed) {
      return Response.json({
        ok: false,
        needsConfirm: true,
        warnings: plan.warnings,
        before: plan.before,
        after: plan.after,
        label: getEventTypeLabel(event.event_type),
      });
    }

    const { data: savedEvent, error: updateEventError } = await supabase
      .from('attendance_events')
      .update({ event_at: newIso })
      .eq('id', eventId)
      .select('*')
      .single();
    if (updateEventError) throw updateEventError;

    const projected = plan.projectedSession;
    const { data: savedSession, error: updateSessionError } = await supabase
      .from('daily_sessions')
      .update({
        check_in_at: projected.check_in_at || null,
        check_out_at: projected.check_out_at || null,
        away_started_at: projected.away_started_at || null,
        away_total_minutes: Math.max(0, Number(projected.away_total_minutes || 0)),
        pure_study_minutes: plan.after.pureStudyMinutes,
        // 수동으로 적어 둔 순공시간이 있으면 계산값과 충돌하므로 비웁니다.
        pure_study_manual_text: null,
      })
      .eq('id', session.id)
      .select('*')
      .single();
    if (updateSessionError) throw updateSessionError;

    await writeUserActionLog(supabase, request, {
      actionType: 'attendance.event.time.update',
      targetType: 'attendance_event',
      targetId: eventId,
      targetName: `${getEventTypeLabel(event.event_type)} ${plan.before.time} → ${plan.after.time}`,
      payload: {
        eventType: event.event_type,
        sessionId: session.id,
        sessionDate: session.session_date,
        studentId: session.student_id,
        previousEventAt: plan.before.iso,
        eventAt: newIso,
        previousPureStudyMinutes: plan.before.pureStudyMinutes,
        pureStudyMinutes: plan.after.pureStudyMinutes,
        previousAwayMinutes: plan.before.awayMinutes,
        awayMinutes: plan.after.awayMinutes,
        sourceType: event.source_type || null,
        warnings: plan.warnings,
        confirmed,
        updatedBy: actorName,
      },
    });

    return Response.json({
      ok: true,
      event: savedEvent,
      session: savedSession,
      warnings: plan.warnings,
      before: plan.before,
      after: plan.after,
      label: getEventTypeLabel(event.event_type),
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
