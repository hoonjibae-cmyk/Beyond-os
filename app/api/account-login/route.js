import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { createAppSessionToken, verifyPassword } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');

    if (!username || !password) {
      return Response.json({ error: '아이디와 비밀번호를 입력하세요.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, email, phone, role, status, permissions, password_hash, password_salt, password_set_at, require_password_change, login_failed_count, locked_until')
      .eq('username', username)
      .maybeSingle();

    if (error) throw error;
    if (!user) return Response.json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }, { status: 401 });
    if (user.status !== 'active') {
      return Response.json({ error: '아직 승인되지 않았거나 비활성화된 계정입니다.' }, { status: 403 });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return Response.json({ error: '로그인 실패가 반복되어 계정이 잠시 잠겼습니다. 잠시 후 다시 시도하세요.' }, { status: 423 });
    }

    if (!user.password_hash || !user.password_salt) {
      return Response.json({ error: '아직 비밀번호가 설정되지 않은 계정입니다. 관리자에게 임시 비밀번호 설정을 요청하세요.' }, { status: 403 });
    }

    const ok = verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) {
      const failedCount = Number(user.login_failed_count || 0) + 1;
      const updatePayload = {
        login_failed_count: failedCount,
        locked_until: failedCount >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null,
      };
      await supabase.from('app_users').update(updatePayload).eq('id', user.id);
      return Response.json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }, { status: 401 });
    }

    await supabase
      .from('app_users')
      .update({
        last_login_at: new Date().toISOString(),
        login_failed_count: 0,
        locked_until: null,
      })
      .eq('id', user.id);

    try {
      await supabase.from('user_action_logs').insert({
        user_id: user.id,
        actor_name: user.display_name || user.username,
        action_type: 'user.login',
        target_type: 'app_user',
        target_id: user.id,
        target_name: user.display_name || user.username,
        payload: { username: user.username },
      });
    } catch {}

    const safeUser = {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      permissions: user.permissions || {},
      requirePasswordChange: Boolean(user.require_password_change),
    };

    const token = createAppSessionToken(user);
    return Response.json({ ok: true, token, user: safeUser });
  } catch (error) {
    return Response.json({
      error: error.message || '로그인 처리 중 오류가 발생했습니다.',
      hint: 'v40-61 SQL(beyond-os-supabase-user-login-v40-61.sql)이 실행되어 있어야 합니다.',
    }, { status: 500 });
  }
}
