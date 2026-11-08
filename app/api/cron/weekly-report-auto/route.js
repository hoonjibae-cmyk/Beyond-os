// Beyond OS v41-287
// 위클리 리포트 자동 생성·발송의 Cron 진입점입니다.
//
// Vercel Cron이 vercel.json의 주기(10분마다)대로 GET으로 호출합니다. 실행기는 설정한
// 요일·시각이 됐는지 스스로 판단하므로 자주 호출돼도 같은 주를 두 번 처리하지 않습니다.
//   Authorization: Bearer <CRON_SECRET>
// 잠금 규칙은 다른 크론(/api/cron/report-send 등)과 같습니다.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getAuthorizedUser } from '../../../../lib/auth';
import { runWeeklyReportAuto, AUTO_RUNS_SQL_HINT } from './runner';

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

async function handle(request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const supabase = getSupabaseAdmin();
    const result = await runWeeklyReportAuto({ supabase, trigger: 'auto', actorName: '자동 발송' });
    return Response.json(result, { status: result.ok === false ? 500 : 200 });
  } catch (error) {
    return Response.json({ error: `${error.message || '위클리 자동 발송 실행 실패'} / ${AUTO_RUNS_SQL_HINT}` }, { status: 500 });
  }
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
