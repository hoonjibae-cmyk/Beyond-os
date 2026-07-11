import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function cleanMemo(value) {
  const raw = String(value || '').trim();
  return raw || null;
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const eventId = String(body.eventId || '').trim();
    const memo = cleanMemo(body.memo);
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    if (!eventId) {
      return Response.json({ error: 'eventId is required' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (existingError) throw existingError;

    const { data: event, error } = await supabase
      .from('attendance_events')
      .update({ memo })
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw error;

    // daily_sessions.attendance_memo는 기존 호환용 필드입니다. 리포트 주요 확인사항은
    // attendance_events.memo를 우선으로 보지만, 관리자 화면의 간단 메모도 함께 맞춰둡니다.
    if (['absent', 'check_in', 'check_out', 'needs_attention'].includes(existing.event_type)) {
      await supabase
        .from('daily_sessions')
        .update({ attendance_memo: memo })
        .eq('id', existing.session_id);
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'attendance.reason.update',
      targetType: 'attendance_event',
      targetId: eventId,
      targetName: existing.event_type || 'attendance_event',
      payload: {
        eventType: existing.event_type,
        sessionId: existing.session_id,
        previousMemo: existing.memo || null,
        memo,
        updatedBy: actorName,
      },
    });

    return Response.json({ ok: true, event });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
