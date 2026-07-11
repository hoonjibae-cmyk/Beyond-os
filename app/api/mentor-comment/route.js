import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    if (!body.sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('id', body.sessionId)
      .single();

    if (sessionError) throw sessionError;

    const { data: existing } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('session_id', body.sessionId)
      .maybeSingle();

    const mentorComment = String(body.mentorComment || '').trim();

    const { data: report, error: reportError } = await supabase
      .from('daily_reports')
      .upsert({
        session_id: session.id,
        student_id: session.student_id,
        report_date: session.session_date,
        report_text: existing?.report_text || '',
        mentor_comment: mentorComment || null,
        send_status: existing?.send_status || 'draft',
        sent_channel: existing?.sent_channel || 'kakao_copy',
        created_by: actorName || existing?.created_by || '관리자',
      }, { onConflict: 'session_id' })
      .select()
      .single();

    if (reportError) throw reportError;

    await writeUserActionLog(supabase, request, {
      actionType: 'mentor_comment.save',
      targetType: 'daily_report',
      targetId: report.id,
      targetName: session.student_id,
      payload: {
        sessionId: session.id,
        studentId: session.student_id,
        reportDate: session.session_date,
      },
    });

    return Response.json({ report });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
