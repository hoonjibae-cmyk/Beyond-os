import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || getKstDateString();

    const { data, error } = await supabase
      .from('report_send_exclusions')
      .select('*')
      .eq('report_date', date)
      .eq('is_excluded', true)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return Response.json({ date, exclusions: data || [] });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    if (!body.sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('id,student_id,session_date')
      .eq('id', body.sessionId)
      .single();

    if (sessionError) throw sessionError;

    const payload = {
      session_id: session.id,
      student_id: session.student_id,
      report_date: session.session_date,
      is_excluded: Boolean(body.isExcluded),
      reason: String(body.reason || '').trim() || null,
      created_by: body.adminName || '관리자',
    };

    const { data, error } = await supabase
      .from('report_send_exclusions')
      .upsert(payload, { onConflict: 'session_id' })
      .select()
      .single();

    if (error) throw error;

    return Response.json({ exclusion: data });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
