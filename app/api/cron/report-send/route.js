// Beyond OS v41-158
// 예약된 리포트 발송을 실행하는 Cron 진입점입니다.
//
// Vercel Cron이 vercel.json의 주기대로 GET으로 호출합니다.
//   Authorization: Bearer <CRON_SECRET>
//
// 자동 하원(/api/auto-checkout)과 같은 잠금 규칙을 씁니다.
//   - Vercel Cron: Bearer CRON_SECRET
//   - 로그인 관리자: 세션 토큰 (수동 실행)
//   - 시크릿 미설정 환경(로컬/프리뷰): 폴백 허용

import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getAuthorizedUser } from '../../../../lib/auth';
import { runDueReportSchedules } from './runner';

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
    const supabase = getSupabaseAdmin();
    const result = await runDueReportSchedules({ supabase, actorName: '예약 발송' });
    return Response.json(result);
  } catch (error) {
    return Response.json({
      error: `${error.message || '예약 발송 실행 실패'} / beyond-os-supabase-report-send-schedules-v41-158.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function GET(request) {
  return handle(request);
}

// 수동 실행/재시도 편의를 위해 POST도 같은 동작으로 열어둡니다.
export async function POST(request) {
  return handle(request);
}
