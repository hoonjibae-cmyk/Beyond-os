import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { diffMinutes, getKstDateString } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { getAuthorizedUser } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// 자동 하원은 전체 미하원 세션을 변경하므로 호출을 잠급니다.
//  - Vercel Cron: Authorization: Bearer <CRON_SECRET>
//  - 브리지/수동: x-kiosk-secret == KIOSK_BRIDGE_SECRET
//  - 대시보드(로그인 관리자): 세션 토큰
//  - 로컬/프리뷰(시크릿 미설정): 폴백 허용
function isCheckoutAuthorized(request) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const kioskSecret = String(process.env.KIOSK_BRIDGE_SECRET || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const incomingKioskSecret = String(request.headers.get('x-kiosk-secret') || '').trim();

  if (cronSecret && bearerToken === cronSecret) return true;
  if (kioskSecret && incomingKioskSecret === kioskSecret) return true;
  const user = getAuthorizedUser(request);
  if (user && user.authType !== 'dev_open') return true;
  if (!cronSecret && !kioskSecret) return true;
  return false;
}

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00+09:00`);
  d.setDate(d.getDate() + amount);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function midnightAfter(sessionDate) {
  return new Date(`${addDays(sessionDate, 1)}T00:00:00+09:00`).toISOString();
}

function calculatePureStudyMinutes(session, checkoutIso, studyWindows) {
  return calculateScheduledPureStudyMinutes(session, { nowIso: checkoutIso, studyWindows });
}

async function runAutoCheckout() {
  const supabase = getSupabaseAdmin();
  const today = getKstDateString();
  const defaultSchedule = await getDefaultScheduleSettings(supabase, today);

  const { data: sessions, error } = await supabase
    .from('daily_sessions')
    .select('*')
    .lt('session_date', today)
    .not('check_in_at', 'is', null)
    .is('check_out_at', null)
    .in('seat_status', ['occupied', 'away', 'needs_attention']);

  if (error) throw error;

  const updated = [];

  for (const session of sessions || []) {
    // 외출 후 복귀 없이 하루가 끝난 경우: 자정이 아니라 "외출 시작 시각"을 실제 퇴실로 봅니다.
    // (18:59에 나가서 안 돌아왔으면 18:59 퇴실이지, 자정까지 외출 5시간이 아님)
    const leftWithoutReturn = session.seat_status === 'away' && Boolean(session.away_started_at);
    const checkoutIso = leftWithoutReturn ? session.away_started_at : midnightAfter(session.session_date);
    const extraAway = (!leftWithoutReturn && session.away_started_at)
      ? diffMinutes(session.away_started_at, checkoutIso)
      : 0;
    const awayTotal = Number(session.away_total_minutes || 0) + extraAway;
    // 순공시간 계산에도 마지막 외출 구간이 더해지지 않도록 정리된 세션 값을 사용합니다.
    const checkoutSession = { ...session, away_started_at: null, away_total_minutes: awayTotal, check_out_at: checkoutIso };
    const pureStudyMinutes = calculatePureStudyMinutes(checkoutSession, checkoutIso, defaultSchedule.studyWindows);

    const { data: saved, error: updateError } = await supabase
      .from('daily_sessions')
      .update({
        seat_status: 'out',
        check_out_at: checkoutIso,
        away_started_at: null,
        away_total_minutes: awayTotal,
        pure_study_minutes: pureStudyMinutes,
        pure_study_manual_text: null,
      })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) throw updateError;

    await supabase.from('attendance_events').insert({
      session_id: session.id,
      student_id: session.student_id,
      seat_no: session.seat_no,
      event_type: 'check_out',
      event_at: checkoutIso,
      memo: leftWithoutReturn ? '시스템 자동 퇴실(외출 후 미복귀 · 외출 시작 시각 기준)' : '시스템 자동 자정 퇴실',
      created_by: 'system',
    });

    updated.push(saved);
  }

  return updated;
}

export async function GET(request) {
  if (!isCheckoutAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const updated = await runAutoCheckout();
    return Response.json({
      ok: true,
      updatedCount: updated.length,
      updated,
      note: 'KST 자정 기준 미퇴실 학생 자동 퇴실 처리',
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
