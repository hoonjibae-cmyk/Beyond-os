// Beyond OS v41-241
// 주간 상벌점 배치의 Cron 진입점입니다.
//
// Vercel Cron이 vercel.json의 주기(매주 월요일 06:00 KST)대로 GET으로 호출합니다.
//   Authorization: Bearer <CRON_SECRET>
//
// 자동 하원(/api/auto-checkout), 예약 발송(/api/cron/report-send)과 같은 잠금 규칙입니다.
//   - Vercel Cron: Bearer CRON_SECRET
//   - 로그인 관리자: 세션 토큰 (화면의 [지금 다시 스캔] 버튼)
//   - 시크릿 미설정 환경(로컬/프리뷰): 폴백 허용

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getAuthorizedUser } from '../../../../lib/auth';
import { AUTO_TABLE_HINT } from '../../../../lib/pointAutoRules';
import { runWeeklyPointBatch } from './runner';

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
  if (!isCronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    // mode=scan 이면 상점은 건드리지 않고 순점수 스캔만 다시 합니다.
    const mode = searchParams.get('mode') === 'scan' ? 'scan' : 'full';
    const runDate = String(searchParams.get('runDate') || '').trim();
    const supabase = getSupabaseAdmin();
    const result = await runWeeklyPointBatch({ supabase, mode, runDate });
    return Response.json(result);
  } catch (error) {
    return Response.json({
      error: `${error.message || '주간 상벌점 배치 실행 실패'} / ${AUTO_TABLE_HINT}`,
    }, { status: 500 });
  }
}

export async function GET(request) {
  return handle(request);
}

// 화면에서 수동 실행할 때 씁니다.
export async function POST(request) {
  return handle(request);
}
