import crypto from 'crypto';

// v41-286: 개인 계정 자동 로그인(로그인 상태 유지)
//
// 로그인 토큰(createAppSessionToken)은 2시간짜리라, 앱을 닫았다가 2시간 뒤에 열면
// 다시 아이디·비밀번호를 넣어야 했습니다. 이 모듈은 기기마다 긴 수명의 '자동 로그인
// 토큰'을 발급해 app_user_remember_tokens 에 해시로 저장합니다. 앱을 열 때 그 토큰으로
// 계정 상태를 확인하고 새 로그인 토큰을 받아 갑니다.
//
// 비밀번호는 어디에도 저장하지 않습니다. 브라우저에는 무작위 토큰만 남고, 서버에는
// 그 토큰의 해시만 남습니다. 계정이 비활성화·삭제되면 그 사용자의 토큰은 모두 폐기되어
// 어느 기기에서도 자동 로그인이 되지 않습니다.

export const REMEMBER_TOKEN_TABLE = 'app_user_remember_tokens';
export const REMEMBER_TOKEN_DAYS = 90;
export const REMEMBER_TOKEN_SQL_HINT = 'beyond-os-supabase-remember-login-v41-286.sql 을 먼저 실행하세요. (app_user_remember_tokens 표 없음)';

function getRememberSecret() {
  return process.env.APP_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'beyond-os-local-session-secret';
}

export function isRememberTableMissing(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || (message.includes(REMEMBER_TOKEN_TABLE) && (message.includes('does not exist') || message.includes('schema cache')));
}

/** 브라우저에 줄 원문 토큰. 저장은 해시로만 합니다. */
export function generateRememberToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRememberToken(rawToken) {
  return crypto.createHmac('sha256', getRememberSecret()).update(String(rawToken || '')).digest('hex');
}

export function rememberTokenExpiry(from = Date.now()) {
  return new Date(from + REMEMBER_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function describeDevice(userAgent = '') {
  const ua = String(userAgent || '');
  const os = /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : '';
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /safari\//i.test(ua) ? 'Safari' : /firefox\//i.test(ua) ? 'Firefox' : '';
  return [os, browser].filter(Boolean).join(' ') || '알 수 없는 기기';
}

/**
 * 자동 로그인 토큰을 새로 만들어 저장합니다.
 * @returns {{ token: string|null, warning: string }} 표가 없으면 token=null 과 안내문
 */
export async function issueRememberToken(supabase, userId, { userAgent = '', clientId = '' } = {}) {
  const raw = generateRememberToken();
  try {
    const { error } = await supabase.from(REMEMBER_TOKEN_TABLE).insert({
      user_id: String(userId),
      token_hash: hashRememberToken(raw),
      device_label: describeDevice(userAgent),
      client_id: String(clientId || '').slice(0, 80) || null,
      expires_at: rememberTokenExpiry(),
      last_used_at: new Date().toISOString(),
    });
    if (error) throw error;
    return { token: raw, warning: '' };
  } catch (error) {
    if (isRememberTableMissing(error)) return { token: null, warning: `자동 로그인은 저장되지 않았습니다. ${REMEMBER_TOKEN_SQL_HINT}` };
    return { token: null, warning: `자동 로그인 저장 실패: ${error?.message || '원인 미상'}` };
  }
}

/**
 * 자동 로그인 토큰으로 사용자를 찾습니다.
 * @returns {{ ok: true, user, tokenRow } | { ok: false, reason: 'missing_table'|'invalid'|'expired'|'revoked'|'inactive'|'deleted'|'error', message }}
 */
export async function consumeRememberToken(supabase, rawToken) {
  const raw = String(rawToken || '').trim();
  if (!raw) return { ok: false, reason: 'invalid', message: '자동 로그인 정보가 없습니다.' };
  const tokenHash = hashRememberToken(raw);
  try {
    const { data: tokenRow, error } = await supabase
      .from(REMEMBER_TOKEN_TABLE)
      .select('id, user_id, expires_at, revoked_at, revoked_reason')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!tokenRow) return { ok: false, reason: 'invalid', message: '자동 로그인 정보가 맞지 않습니다. 다시 로그인해 주세요.' };
    if (tokenRow.revoked_at) {
      return { ok: false, reason: 'revoked', message: tokenRow.revoked_reason === 'inactive' ? '사용이 중지된 계정입니다. 관리자에게 문의하세요.' : '자동 로그인이 해지되었습니다. 다시 로그인해 주세요.' };
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired', message: `자동 로그인 유효기간(${REMEMBER_TOKEN_DAYS}일)이 지났습니다. 다시 로그인해 주세요.` };
    }

    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('id, username, display_name, email, phone, role, status, permissions, require_password_change')
      .eq('id', tokenRow.user_id)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) {
      await revokeRememberTokensForUser(supabase, tokenRow.user_id, 'deleted');
      return { ok: false, reason: 'deleted', message: '삭제된 계정입니다. 관리자에게 문의하세요.' };
    }
    if (user.status !== 'active') {
      // 계정이 비활성화되면 이 사용자의 자동 로그인은 모든 기기에서 즉시 해지됩니다.
      await revokeRememberTokensForUser(supabase, user.id, 'inactive');
      return { ok: false, reason: 'inactive', message: '사용이 중지된 계정입니다. 관리자에게 문의하세요.' };
    }

    // 쓸 때마다 유효기간을 다시 90일로 늘립니다. (계속 쓰는 기기는 끊기지 않음)
    await supabase
      .from(REMEMBER_TOKEN_TABLE)
      .update({ last_used_at: new Date().toISOString(), expires_at: rememberTokenExpiry() })
      .eq('id', tokenRow.id);

    return { ok: true, user, tokenRow };
  } catch (error) {
    if (isRememberTableMissing(error)) return { ok: false, reason: 'missing_table', message: REMEMBER_TOKEN_SQL_HINT };
    return { ok: false, reason: 'error', message: error?.message || '자동 로그인 확인 실패' };
  }
}

/** 토큰 한 개 폐기 (로그아웃) */
export async function revokeRememberToken(supabase, rawToken, reason = 'logout') {
  const raw = String(rawToken || '').trim();
  if (!raw) return false;
  try {
    const { error } = await supabase
      .from(REMEMBER_TOKEN_TABLE)
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('token_hash', hashRememberToken(raw))
      .is('revoked_at', null);
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}

/** 한 사용자의 토큰 전부 폐기 (비활성화·삭제·임시 비밀번호 설정) */
export async function revokeRememberTokensForUser(supabase, userId, reason = 'revoked') {
  if (!userId) return 0;
  try {
    const { data, error } = await supabase
      .from(REMEMBER_TOKEN_TABLE)
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('user_id', String(userId))
      .is('revoked_at', null)
      .select('id');
    if (error) throw error;
    return (data || []).length;
  } catch {
    return 0;
  }
}

export function toSafeUser(row) {
  return {
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
}
