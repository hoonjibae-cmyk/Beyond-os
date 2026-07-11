import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { canManageUsers, forbiddenResponse, hashPassword, isAuthorized, unauthorizedResponse, getAuthorizedUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const LOG_RETENTION_HOURS = 48;

async function cleanupOldUserActionLogs(supabase) {
  const cutoff = new Date(Date.now() - LOG_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  try {
    await supabase.from('user_action_logs').delete().lt('created_at', cutoff);
  } catch {
    // 로그 정리 실패가 유저 관리 기능을 막지는 않습니다.
  }
}


const DEFAULT_USER_PERMISSIONS = {
  dashboard: true,
  schedules: true,
  planner: true,
  dailyReports: true,
  weeklyReports: true,
  ranking: true,
  attendance: true,
  attention: true,
  settings: false,
  userManagement: false,
};

const DEFAULT_ADMIN_PERMISSIONS = {
  ...DEFAULT_USER_PERMISSIONS,
  settings: true,
  userManagement: true,
};

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function normalizePermissions(role, permissions = {}) {
  const base = role === 'super_admin' ? DEFAULT_ADMIN_PERMISSIONS : DEFAULT_USER_PERMISSIONS;
  return { ...base, ...(permissions || {}) };
}

async function loadPayload(supabase) {
  await cleanupOldUserActionLogs(supabase);
  const { data: users, error: usersError } = await supabase
    .from('app_users')
    .select('id, auth_user_id, username, display_name, email, phone, role, status, permissions, privacy_agreed_at, terms_agreed_at, approved_by, approved_at, last_login_at, password_set_at, password_reset_requested_at, require_password_change, locked_until, memo, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (usersError) throw usersError;

  let logs = [];
  try {
    const { data: logRows, error: logsError } = await supabase
      .from('user_action_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (!logsError) logs = logRows || [];
  } catch {
    logs = [];
  }

  return { users: users || [], logs, logRetentionHours: LOG_RETENTION_HOURS };
}

async function writeLog(supabase, payload) {
  try {
    await supabase.from('user_action_logs').insert({
      actor_name: '공용 관리자',
      action_type: payload.actionType,
      target_type: 'app_user',
      target_id: payload.targetId || null,
      target_name: payload.targetName || null,
      payload: payload.payload || {},
    });
  } catch {
    // 로그 테이블이 아직 없어도 관리 기능 자체는 막지 않습니다.
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  if (!canManageUsers(request)) return forbiddenResponse();

  try {
    const supabase = getSupabaseAdmin();
    const payload = await loadPayload(supabase);
    return Response.json(payload);
  } catch (error) {
    return Response.json({
      error: error.message || 'Unknown error',
      hint: 'v40-59 SQL(beyond-os-supabase-user-access-v40-59.sql)을 먼저 실행했는지 확인하세요.',
    }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  if (!canManageUsers(request)) return forbiddenResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const action = body.action || 'update';
    const role = body.role === 'super_admin' ? 'super_admin' : 'user';
    const status = body.status || 'pending';
    const permissions = normalizePermissions(role, body.permissions);

    if (action === 'create') {
      const username = normalizeUsername(body.username);
      const displayName = String(body.displayName || body.display_name || '').trim();

      if (!username || !displayName) {
        return Response.json({ error: '아이디와 이름을 입력하세요.' }, { status: 400 });
      }

      const { data: saved, error } = await supabase
        .from('app_users')
        .insert({
          username,
          display_name: displayName,
          email: String(body.email || '').trim() || null,
          phone: String(body.phone || '').trim() || null,
          role,
          status,
          permissions,
          memo: String(body.memo || '').trim() || null,
          terms_agreed_at: body.termsAgreed ? new Date().toISOString() : null,
          privacy_agreed_at: body.privacyAgreed ? new Date().toISOString() : null,
          approved_by: status === 'active' ? '공용 관리자' : null,
          approved_at: status === 'active' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error) throw error;

      await writeLog(supabase, {
        actionType: 'user.create',
        targetId: saved.id,
        targetName: saved.display_name || saved.username,
        payload: { username, role, status },
      });

      return Response.json(await loadPayload(supabase));
    }

    if (action === 'set_password') {
      if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });
      const password = String(body.password || '');
      if (password.length < 8) {
        return Response.json({ error: '임시 비밀번호는 8자 이상으로 입력하세요.' }, { status: 400 });
      }

      const { salt, hash } = hashPassword(password);
      const { data: saved, error } = await supabase
        .from('app_users')
        .update({
          password_hash: hash,
          password_salt: salt,
          password_set_at: new Date().toISOString(),
          require_password_change: Boolean(body.requirePasswordChange ?? true),
          password_reset_requested_at: null,
          login_failed_count: 0,
          locked_until: null,
        })
        .eq('id', body.id)
        .select('id, username, display_name')
        .single();

      if (error) throw error;

      const actor = getAuthorizedUser(request);
      await writeLog(supabase, {
        actionType: 'user.password.set',
        targetId: saved.id,
        targetName: saved.display_name || saved.username,
        payload: { requirePasswordChange: Boolean(body.requirePasswordChange ?? true), actor: actor?.displayName || '관리자' },
      });

      return Response.json(await loadPayload(supabase));
    }

    if (action === 'update') {
      if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });

      const updatePayload = {
        username: normalizeUsername(body.username),
        display_name: String(body.displayName || body.display_name || '').trim() || null,
        email: String(body.email || '').trim() || null,
        phone: String(body.phone || '').trim() || null,
        role,
        status,
        permissions,
        memo: String(body.memo || '').trim() || null,
      };

      if (status === 'active') {
        updatePayload.approved_by = body.approvedBy || '공용 관리자';
        updatePayload.approved_at = new Date().toISOString();
      }

      const { data: saved, error } = await supabase
        .from('app_users')
        .update(updatePayload)
        .eq('id', body.id)
        .select()
        .single();

      if (error) throw error;

      await writeLog(supabase, {
        actionType: 'user.update',
        targetId: saved.id,
        targetName: saved.display_name || saved.username,
        payload: { role, status, permissions },
      });

      return Response.json(await loadPayload(supabase));
    }

    return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: error.message || 'Unknown error',
      hint: 'v40-59 SQL(beyond-os-supabase-user-access-v40-59.sql)을 먼저 실행했는지 확인하세요.',
    }, { status: 500 });
  }
}
