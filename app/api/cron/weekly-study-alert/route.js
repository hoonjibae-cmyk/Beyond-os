// Beyond OS v41-289
// 주간 순공시간 부족 슬랙 알림의 Cron 진입점. Vercel Cron이 10분마다 GET으로 호출하고,
// 실행기가 설정한 요일·시각이 됐는지 스스로 판단합니다. (같은 주는 한 번만)
//   Authorization: Bearer <CRON_SECRET>
// POST { force: true, runDate? } 는 화면의 [지금 보내기] 용입니다. (상벌점 관리 탭 권한)

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getAuthorizedUser, requireTabPermission } from '../../../../lib/auth';
import { runWeeklyStudyAlert } from './runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isCronAuthorized(request) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  if (cronSecret && bearerToken === cronSecret) return true;
  const user = getAuthorizedUser(request);
  if (user && user.authType !== 'dev_open') return true;
  if (!cronSecret) return true;
  return false;
}

export async function GET(request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runWeeklyStudyAlert({ supabase: getSupabaseAdmin(), actorName: '시스템' });
    return Response.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    return Response.json({ error: error.message || '주간 순공 슬랙 알림 실행 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const actor = getAuthorizedUser(request);
    const result = await runWeeklyStudyAlert({
      supabase: getSupabaseAdmin(),
      force: body.force === true,
      runDate: String(body.runDate || ''),
      actorName: actor?.displayName || '관리자',
    });
    return Response.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    return Response.json({ error: error.message || '주간 순공 슬랙 알림 실행 실패' }, { status: 500 });
  }
}
