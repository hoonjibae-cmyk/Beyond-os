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

    const basePayload = {
      session_id: session.id,
      student_id: session.student_id,
      report_date: session.session_date,
      report_text: existing?.report_text || '',
      mentor_comment: mentorComment || null,
      send_status: existing?.send_status || 'draft',
      sent_channel: existing?.sent_channel || 'kakao_copy',
      created_by: actorName || existing?.created_by || '관리자',
    };

    // v41-129: 코멘트를 실제로 작성한 멘토를 별도 컬럼에 기록합니다.
    // (created_by 는 리포트 생성·발송 등 다른 작업에서도 갱신되어 작성자 표기에 부적합)
    // 마이그레이션 SQL 미적용 환경에서도 저장이 막히지 않도록 폴백합니다.
    const payloadWithAuthor = {
      ...basePayload,
      mentor_comment_by: mentorComment ? actorName : null,
      mentor_comment_at: mentorComment ? new Date().toISOString() : null,
    };

    const upsertReport = async (payload) => supabase
      .from('daily_reports')
      .upsert(payload, { onConflict: 'session_id' })
      .select()
      .single();

    let report = null;
    let reportError = null;
    ({ data: report, error: reportError } = await upsertReport(payloadWithAuthor));
    if (reportError) {
      // mentor_comment_by / mentor_comment_at 컬럼이 아직 없는 경우 기존 방식으로 저장합니다.
      ({ data: report, error: reportError } = await upsertReport(basePayload));
    }

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
