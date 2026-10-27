// Beyond OS v41-279 — [최근 출결 이력] 한 건 삭제
//
// 이벤트를 지운 뒤 daily_sessions 의 입실/퇴실/외출/순공시간/좌석 상태를 남은 이벤트로 다시 만듭니다.
// confirm:true 가 아니면 지우지 않고, 무엇이 달라지는지(경고)만 돌려줍니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { planAttendanceEventDeletion, getEventTypeLabel } from '../../../lib/attendanceEventTime';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const eventId = String(body.eventId || '').trim();
    const confirmed = body.confirm === true;
    if (!eventId) return Response.json({ error: 'eventId is required' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const { data: event, error: eventError } = await supabase.from('attendance_events').select('*').eq('id', eventId).single();
    if (eventError) throw eventError;
    if (!event?.session_id) return Response.json({ error: '이 기록은 출결 세션에 연결되어 있지 않아 여기서 지울 수 없습니다.' }, { status: 400 });

    const { data: session, error: sessionError } = await supabase.from('daily_sessions').select('*').eq('id', event.session_id).single();
    if (sessionError) throw sessionError;
    const { data: events, error: eventsError } = await supabase.from('attendance_events').select('*').eq('session_id', event.session_id);
    if (eventsError) throw eventsError;

    const defaultSchedule = await getDefaultScheduleSettings(supabase, session.session_date);
    const plan = planAttendanceEventDeletion({ event, session, events: events || [], studyWindows: defaultSchedule.studyWindows });
    if (!plan.ok) return Response.json({ error: plan.blocked.join(' / ') }, { status: 400 });

    if (!confirmed) {
      return Response.json({ ok: false, needsConfirm: true, warnings: plan.warnings, before: plan.before, after: plan.after, label: getEventTypeLabel(event.event_type) });
    }

    const { error: deleteError } = await supabase.from('attendance_events').delete().eq('id', eventId);
    if (deleteError) throw deleteError;

    const projected = plan.projectedSession;
    const { data: savedSession, error: updateError } = await supabase
      .from('daily_sessions')
      .update({
        check_in_at: projected.check_in_at || null,
        check_out_at: projected.check_out_at || null,
        away_started_at: projected.away_started_at || null,
        away_total_minutes: Math.max(0, Number(projected.away_total_minutes || 0)),
        pure_study_minutes: plan.after.pureStudyMinutes,
        pure_study_manual_text: null,
        seat_status: plan.seatStatus,
      })
      .eq('id', session.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await writeUserActionLog(supabase, request, {
      actionType: 'attendance.event.delete',
      targetType: 'attendance_event',
      targetId: eventId,
      targetName: `${getEventTypeLabel(event.event_type)} ${plan.before.time} 삭제`,
      payload: {
        deletedEvent: event,
        sessionId: session.id,
        sessionDate: session.session_date,
        studentId: session.student_id,
        before: plan.before,
        after: plan.after,
        warnings: plan.warnings,
        deletedBy: actorName,
      },
    });

    return Response.json({ ok: true, session: savedSession, warnings: plan.warnings, before: plan.before, after: plan.after, label: getEventTypeLabel(event.event_type), message: `${getEventTypeLabel(event.event_type)} ${plan.before.time} 기록을 삭제했습니다.` });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
