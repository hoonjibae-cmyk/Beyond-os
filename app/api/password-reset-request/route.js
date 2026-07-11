import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const identifier = String(body.identifier || '').trim();
    const memo = String(body.memo || '').trim().slice(0, 500);

    if (!identifier) {
      return Response.json({ error: '아이디 또는 이메일을 입력하세요.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const username = normalizeUsername(identifier);
    const phoneDigits = normalizePhone(identifier);
    const lowerIdentifier = identifier.toLowerCase();

    const { data: users, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, email, phone, status')
      .limit(500);

    if (error) throw error;

    const matched = (users || []).find((user) => (
      user.username === username
      || String(user.email || '').toLowerCase() === lowerIdentifier
      || (phoneDigits && normalizePhone(user.phone) === phoneDigits)
    ));

    const now = new Date().toISOString();

    if (matched) {
      await supabase
        .from('app_users')
        .update({ password_reset_requested_at: now })
        .eq('id', matched.id);

      try {
        await supabase.from('user_action_logs').insert({
          user_id: matched.id,
          actor_name: matched.display_name || matched.username,
          action_type: 'user.password.reset_request',
          target_type: 'app_user',
          target_id: matched.id,
          target_name: matched.display_name || matched.username,
          payload: {
            username: matched.username,
            memo,
            requestedFrom: 'login_screen',
          },
        });
      } catch {}
    } else {
      try {
        await supabase.from('user_action_logs').insert({
          actor_name: '미확인 사용자',
          action_type: 'user.password.reset_request',
          target_type: 'app_user',
          target_id: null,
          target_name: identifier,
          payload: {
            identifier,
            memo,
            matched: false,
            requestedFrom: 'login_screen',
          },
        });
      } catch {}
    }

    return Response.json({
      ok: true,
      message: '비밀번호 재설정 요청이 접수되었습니다. 관리자 확인 후 임시 비밀번호를 안내받으세요.',
    });
  } catch (error) {
    return Response.json({
      error: error.message || '비밀번호 재설정 요청 중 오류가 발생했습니다.',
      hint: 'v40-59/v40-61 SQL 실행 여부를 확인하세요.',
    }, { status: 500 });
  }
}
