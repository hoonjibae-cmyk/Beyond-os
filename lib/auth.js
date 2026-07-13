import crypto from 'crypto';

function getSessionSecret() {
  return process.env.APP_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'beyond-os-local-session-secret';
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

export function createAppSessionToken(user, maxAgeSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'BOS' };
  const payload = {
    sub: user.id,
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    role: user.role || 'user',
    status: user.status || 'active',
    permissions: user.permissions || {},
    iat: now,
    exp: now + maxAgeSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function parseAppSessionToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = signValue(`${header}.${payload}`);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);
    if (!parsed?.sub || parsed.status !== 'active') return null;
    if (parsed.exp && parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getAuthorizedUser(request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const requestPassword = request.headers.get('x-admin-password');

  if (adminPassword && requestPassword === adminPassword) {
    return {
      authType: 'admin_password',
      id: 'admin-password',
      username: 'admin',
      displayName: '공용 관리자',
      role: 'super_admin',
      permissions: { settings: true, userManagement: true },
    };
  }

  const token = request.headers.get('x-app-session-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const session = parseAppSessionToken(token);
  if (session) {
    return {
      authType: 'app_user',
      id: session.sub,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      permissions: session.permissions || {},
    };
  }

  if (!adminPassword && !token) {
    return {
      authType: 'dev_open',
      id: 'dev-open',
      username: 'dev',
      displayName: '개발 모드',
      role: 'super_admin',
      permissions: { settings: true, userManagement: true },
    };
  }

  return null;
}

export function isAuthorized(request) {
  return Boolean(getAuthorizedUser(request));
}

export function canManageUsers(request) {
  const user = getAuthorizedUser(request);
  if (!user) return false;
  return user.role === 'super_admin' || Boolean(user.permissions?.userManagement);
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}


export function hasPermission(request, permissionKey) {
  const user = getAuthorizedUser(request);
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return Boolean(user.permissions?.[permissionKey]);
}

// 탭 접근 권한 키. 클라이언트 USER_PERMISSION_TABS 와 동일한 목록이며,
// 일반 유저에게는 기본 허용(명시적으로 false 인 경우만 차단)됩니다.
const TAB_PERMISSION_KEYS = [
  'dashboard', 'schedules', 'planner', 'dailyReports', 'weeklyReports',
  'ranking', 'studentHistory', 'points', 'mentoring', 'attention',
];

// 서버측 탭 권한 판정 — 클라이언트 hasPagePermission/getEffectivePermissions 와 동일한 의미.
// (저장된 permissions 가 sparse 이므로, 탭 키는 명시적 false 만 차단하고 나머지는 허용)
export function userHasTabPermission(user, key) {
  if (!user || !key) return false;
  if (user.role === 'super_admin') return true;
  const perms = user.permissions || {};
  if (key === 'settings' || key === 'userManagement') return Boolean(perms[key]);
  // 학습 관리는 legacy 'attendance' 권한도 인정
  if (key === 'studentHistory') return perms.studentHistory !== false || perms.attendance === true;
  if (TAB_PERMISSION_KEYS.includes(key)) return perms[key] !== false;
  return Boolean(perms[key]);
}

// 라우트 상단에서 사용: 통과 시 null, 차단 시 401/403 Response 를 반환합니다.
//   const denied = requireTabPermission(request, 'dailyReports');
//   if (denied) return denied;
export function requireTabPermission(request, key) {
  const user = getAuthorizedUser(request);
  if (!user) return unauthorizedResponse();
  if (userHasTabPermission(user, key)) return null;
  return forbiddenResponse();
}
