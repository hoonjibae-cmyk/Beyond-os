import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { diffMinutes, getKstDateString } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { getAuthorizedUser } from '../../../lib/auth';
import { getClosingOffsetMinutes } from '../../../lib/businessDateServer';
import { getDayBoundaryMinutes } from '../../../lib/businessDate';

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

// v41-245: 마감 시각은 "세션 날짜 다음 날 자정 + 설정 분"입니다.
//   0   → 자정 정각 (예전과 같음)
//   60  → 새벽 1시
function closingAfter(sessionDate, offsetMinutes = 0) {
  const base = new Date(midnightAfter(sessionDate)).getTime();
  return new Date(base + Math.max(0, Number(offsetMinutes || 0)) * 60000).toISOString();
}

function formatClosingLabel(offsetMinutes = 0) {
  const total = Math.max(0, Math.round(Number(offsetMinutes || 0)));
  if (!total) return '자정';
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  if (!hour) return `자정 ${minute}분`;
  return minute ? `새벽 ${hour}시 ${minute}분` : `새벽 ${hour}시`;
}

function calculatePureStudyMinutes(session, checkoutIso, studyWindows) {
  return calculateScheduledPureStudyMinutes(session, { nowIso: checkoutIso, studyWindows });
}

async function runAutoCheckout() {
  const supabase = getSupabaseAdmin();
  const today = getKstDateString();
  const defaultSchedule = await getDefaultScheduleSettings(supabase, today);
  const offsetMinutes = await getClosingOffsetMinutes(supabase);
  // v41-249: 도는 시각은 '마감 + 1시간'(= 하루 경계), 기록하는 시각은 '마감'입니다.
  //
  // 마감에 바로 돌리면, 마감 직후(예: 01:05)에 나가는 학생의 실제 퇴실 문자가
  // 이미 닫힌 세션으로 들어와 보정 경로를 타야 했습니다. 한 시간 미뤄 두면 그
  // 시간대 퇴실은 열려 있는 세션에 평소처럼 실제 시각으로 기록됩니다.
  //
  // 끝까지 찍지 않은 학생만 경계 시각에 정리되며, 그때 남는 퇴실 시각은 실제로
  // 문을 닫은 시각(마감)입니다. 한 시간 뒤가 아닙니다.
  const boundaryMinutes = getDayBoundaryMinutes(offsetMinutes);
  const nowMs = Date.now();

  const { data: sessions, error } = await supabase
    .from('daily_sessions')
    .select('*')
    .lt('session_date', today)
    .not('check_in_at', 'is', null)
    .is('check_out_at', null)
    .in('seat_status', ['occupied', 'away', 'needs_attention']);

  if (error) throw error;

  const updated = [];
  let waiting = 0;

  for (const session of sessions || []) {
    // v41-245: 마감 시각이 아직 지나지 않았으면 건드리지 않습니다.
    //
    // 대상 조건이 '세션 날짜 < 오늘(KST)' 이라, 자정만 지나면 전날 세션이 곧바로
    // 걸립니다. 마감이 새벽 1시인데 00:30 에 이 함수가 돌면(크론이든, 직원이
    // 대시보드를 여는 순간이든) 아직 앉아 있는 학생이 퇴실 처리돼 버립니다.
    // 기록할 퇴실 시각(마감)과 정리를 시작하는 시각(경계)은 다릅니다.
    const closingIso = closingAfter(session.session_date, offsetMinutes);
    const boundaryIso = closingAfter(session.session_date, boundaryMinutes);
    if (nowMs < new Date(boundaryIso).getTime()) {
      waiting += 1;
      continue;
    }

    // 외출 후 복귀 없이 하루가 끝난 경우: 마감 시각이 아니라 "외출 시작 시각"을 실제 퇴실로 봅니다.
    // (18:59에 나가서 안 돌아왔으면 18:59 퇴실이지, 마감까지 외출 5시간이 아님)
    const leftWithoutReturn = session.seat_status === 'away' && Boolean(session.away_started_at);
    const checkoutIso = leftWithoutReturn ? session.away_started_at : closingIso;
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
      // '자정 퇴실' 문구는 키오스크 보정 쪽에서 자동 퇴실을 알아보는 표시로도 쓰입니다.
      // (created_by: 'system' 으로도 걸리지만, 예전 기록과 표현을 맞춰 둡니다)
      memo: leftWithoutReturn
        ? '시스템 자동 퇴실(외출 후 미복귀 · 외출 시작 시각 기준)'
        : `시스템 자동 자정 퇴실(마감 ${formatClosingLabel(offsetMinutes)} 기준)`,
      created_by: 'system',
    });

    updated.push(saved);
  }

  return { updated, offsetMinutes, waiting };
}

export async function GET(request) {
  if (!isCheckoutAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { updated, offsetMinutes, waiting } = await runAutoCheckout();
    return Response.json({
      ok: true,
      updatedCount: updated.length,
      updated,
      closingLabel: formatClosingLabel(offsetMinutes),
      closingAfterMidnightMinutes: offsetMinutes,
      // 실제로 정리를 시작하는 시각 (마감 + 1시간)
      sweepLabel: formatClosingLabel(getDayBoundaryMinutes(offsetMinutes)),
      // 마감 전이라 아직 손대지 않은 세션 수
      waitingCount: waiting,
      note: `KST ${formatClosingLabel(getDayBoundaryMinutes(offsetMinutes))}부터 정리 · 퇴실 시각은 마감 ${formatClosingLabel(offsetMinutes)}으로 기록`,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
