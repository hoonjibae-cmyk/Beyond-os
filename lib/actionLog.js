import { getAuthorizedUser } from './auth';

const LOG_RETENTION_HOURS = 48;

export async function cleanupOldUserActionLogs(supabase) {
  const cutoff = new Date(Date.now() - LOG_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  try {
    await supabase.from('user_action_logs').delete().lt('created_at', cutoff);
  } catch {
    // 로그 보관 정리 실패가 본 작업 저장을 막지는 않습니다.
  }
}


export function getActorSnapshot(request) {
  const user = getAuthorizedUser(request);
  if (!user) {
    return {
      userId: null,
      actorName: '알 수 없음',
      username: null,
      role: null,
      authType: 'unknown',
    };
  }

  return {
    userId: user.authType === 'app_user' ? user.id : null,
    actorName: user.displayName || user.username || '관리자',
    username: user.username || null,
    role: user.role || null,
    authType: user.authType || null,
  };
}

export async function writeUserActionLog(supabase, request, {
  actionType,
  targetType = null,
  targetId = null,
  targetName = null,
  payload = {},
} = {}) {
  if (!actionType) return null;

  const actor = getActorSnapshot(request);

  try {
    await cleanupOldUserActionLogs(supabase);
    const { data, error } = await supabase
      .from('user_action_logs')
      .insert({
        user_id: actor.userId,
        actor_name: actor.actorName,
        action_type: actionType,
        target_type: targetType,
        target_id: targetId ? String(targetId) : null,
        target_name: targetName || null,
        payload: {
          ...(payload || {}),
          actor: {
            username: actor.username,
            role: actor.role,
            authType: actor.authType,
          },
        },
      })
      .select()
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}
