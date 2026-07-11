import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { createAppSessionToken, getAuthorizedUser, hashPassword, isAuthorized, unauthorizedResponse, verifyPassword } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const actor = getAuthorizedUser(request);
    if (!actor || actor.authType !== 'app_user') {
      return Response.json({ error: '개인 계정으로 로그인한 경우에만 비밀번호를 변경할 수 있습니다.' }, { status: 400 });
    }

    const body = await request.json();
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!currentPassword || !newPassword || !confirmPassword) {
      return Response.json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력하세요.' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return Response.json({ error: '새 비밀번호는 8자 이상으로 입력하세요.' }, { status: 400 });
    }
    if (newPassword !== confirmPassword) {
      return Response.json({ error: '새 비밀번호 확인이 일치하지 않습니다.' }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return Response.json({ error: '새 비밀번호는 현재 비밀번호와 다르게 설정하세요.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, email, phone, role, status, permissions, password_hash, password_salt')
      .eq('id', actor.id)
      .maybeSingle();

    if (error) throw error;
    if (!user || user.status !== 'active') {
      return Response.json({ error: '활성 계정을 찾을 수 없습니다.' }, { status: 404 });
    }

    const ok = verifyPassword(currentPassword, user.password_salt, user.password_hash);
    if (!ok) {
      return Response.json({ error: '현재 비밀번호가 맞지 않습니다.' }, { status: 401 });
    }

    const { salt, hash } = hashPassword(newPassword);
    const { data: saved, error: updateError } = await supabase
      .from('app_users')
      .update({
        password_hash: hash,
        password_salt: salt,
        password_set_at: new Date().toISOString(),
        require_password_change: false,
        password_reset_requested_at: null,
        login_failed_count: 0,
        locked_until: null,
      })
      .eq('id', user.id)
      .select('id, username, display_name, email, phone, role, status, permissions, require_password_change')
      .single();

    if (updateError) throw updateError;

    await writeUserActionLog(supabase, request, {
      actionType: 'user.password.change',
      targetType: 'app_user',
      targetId: saved.id,
      targetName: saved.display_name || saved.username,
      payload: { self: true },
    });

    const safeUser = {
      id: saved.id,
      username: saved.username,
      displayName: saved.display_name || saved.username,
      email: saved.email,
      phone: saved.phone,
      role: saved.role,
      status: saved.status,
      permissions: saved.permissions || {},
      requirePasswordChange: Boolean(saved.require_password_change),
    };

    const token = createAppSessionToken(saved);
    return Response.json({ ok: true, token, user: safeUser, message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    return Response.json({ error: error.message || '비밀번호 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
