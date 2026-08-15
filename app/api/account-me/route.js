import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { createAppSessionToken, getAuthorizedUser, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// v41-183: 세션 상태 재확인 + 토큰 갱신
//
// 로그인 토큰은 발급 시점의 역할·권한·상태를 그대로 담고 있습니다.
// 그래서 유저 관리에서 계정을 비활성화해도, 이미 발급된 토큰은 만료 전까지
// 그대로 통과했습니다. (로그인 자체는 막히지만 이미 켜 둔 브라우저는 계속 동작)
//
// 이 엔드포인트가 그 구멍을 막습니다. 앱을 열 때, 창으로 돌아올 때, 그리고
// 사용 중 주기적으로 호출되어 DB의 현재 계정 상태를 직접 확인합니다.
//   · 비활성/삭제된 계정 → 401 (화면은 즉시 로그아웃 처리)
//   · 활성 계정        → 새 토큰을 발급해 로그인 상태를 이어 줍니다.
// 역할·권한도 함께 새로 내려주므로 권한 변경도 재로그인 없이 반영됩니다.
export async function GET(request) {
  const user = getAuthorizedUser(request);
  if (!user) return unauthorizedResponse();

  // 공용 관리자 비밀번호 접속과 개발 모드는 app_users 행이 없습니다.
  if (user.authType !== 'app_user') {
    return Response.json({ ok: true, user, checked: false });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, email, phone, role, status, permissions, require_password_change')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;

    if (!row) {
      return Response.json(
        { error: '삭제된 계정입니다. 관리자에게 문의하세요.', reason: 'missing' },
        { status: 401 },
      );
    }
    if (row.status !== 'active') {
      return Response.json(
        { error: '사용이 중지된 계정입니다. 관리자에게 문의하세요.', reason: 'inactive', status: row.status },
        { status: 401 },
      );
    }

    const safeUser = {
      id: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      email: row.email,
      phone: row.phone,
      role: row.role,
      status: row.status,
      permissions: row.permissions || {},
      requirePasswordChange: Boolean(row.require_password_change),
    };

    return Response.json({ ok: true, checked: true, user: safeUser, token: createAppSessionToken(row) });
  } catch (error) {
    // DB 장애로 전원이 튕겨 나가지 않도록, '확인 실패'는 로그아웃시키지 않습니다.
    // 대신 checked:false 로 알려 주고 토큰도 갱신하지 않습니다.
    // (토큰 수명이 짧으므로 장애가 이어지면 자연히 만료됩니다)
    return Response.json({ ok: true, checked: false, user, warning: error.message || '계정 상태 확인 실패' });
  }
}
