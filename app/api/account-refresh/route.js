import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { createAppSessionToken } from '../../../lib/auth';
import { consumeRememberToken, toSafeUser } from '../../../lib/rememberLogin';

export const dynamic = 'force-dynamic';

// v41-286: 자동 로그인 토큰 → 새 로그인 토큰
//
// 앱을 열었는데 2시간짜리 로그인 토큰이 만료되어 있으면, 브라우저에 남긴 자동 로그인
// 토큰으로 여기를 부릅니다. 서버는 토큰 해시를 찾아 계정이 지금도 활성인지 확인한 뒤
// 새 로그인 토큰을 줍니다. 비활성·삭제 계정이면 그 사용자의 토큰을 모두 폐기하고 401 을
// 돌려주며, 화면은 저장된 자동 로그인 정보를 지웁니다.
export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const rawToken = String(body.rememberToken || '').trim();
  if (!rawToken) return Response.json({ error: '자동 로그인 정보가 없습니다.', reason: 'invalid' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const result = await consumeRememberToken(supabase, rawToken);
  if (!result.ok) {
    // 표가 없거나 DB 장애면 '지금은 확인 불가'로 알리고, 화면은 저장된 정보를 지우지 않습니다.
    if (result.reason === 'missing_table' || result.reason === 'error') {
      return Response.json({ error: result.message, reason: result.reason }, { status: 503 });
    }
    return Response.json({ error: result.message, reason: result.reason }, { status: 401 });
  }

  const user = result.user;
  try {
    await supabase.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
  } catch {}
  try {
    await supabase.from('user_action_logs').insert({
      user_id: user.id,
      actor_name: user.display_name || user.username,
      action_type: 'user.login.remembered',
      target_type: 'app_user',
      target_id: user.id,
      target_name: user.display_name || user.username,
      payload: { username: user.username, rememberTokenId: result.tokenRow.id },
    });
  } catch {}

  return Response.json({ ok: true, checked: true, token: createAppSessionToken(user), user: toSafeUser(user) });
}
