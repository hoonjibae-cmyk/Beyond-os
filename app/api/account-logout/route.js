import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { revokeRememberToken } from '../../../lib/rememberLogin';

export const dynamic = 'force-dynamic';

// v41-286: 로그아웃 때 이 기기의 자동 로그인 토큰을 폐기합니다.
// 토큰 자체가 자격 증명이므로 별도 인증 없이 폐기만 받습니다. (실패해도 화면은 로그아웃)
export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const revoked = await revokeRememberToken(getSupabaseAdmin(), body.rememberToken, 'logout');
  return Response.json({ ok: true, revoked });
}
