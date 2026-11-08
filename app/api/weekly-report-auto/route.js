// Beyond OS v41-287
// 위클리 리포트 자동 발송 설정 조회·저장과 [지금 실행]
//
//   GET                     설정 + 다음 실행 예정 + 최근 실행 기록
//   POST action=save        설정 저장 (weeklyReports 탭 권한)
//   POST action=run_now     지정한 주를 지금 바로 구성·발송 (설정 켜짐 여부와 무관)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getReportSendSettings, saveReportSendSettings } from '../../../lib/reportSendSettings';
import { getSlackPointConfig } from '../../../lib/slackNotify';
import { normalizeWeeklyAutoSendSettings, getNextWeeklyAutoSendRun, describeWeeklyAutoSendSettings } from '../../../lib/weeklyAutoSend';
import { runWeeklyReportAuto, loadRecentAutoRuns } from '../cron/weekly-report-auto/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function buildPayload(supabase) {
  const { settings: all, warning } = await getReportSendSettings(supabase);
  const settings = normalizeWeeklyAutoSendSettings(all.weeklyAutoSend);
  const runs = await loadRecentAutoRuns(supabase, 10);
  return {
    ok: true,
    settings,
    description: describeWeeklyAutoSendSettings(settings),
    nextRun: getNextWeeklyAutoSendRun(settings),
    slackConfigured: getSlackPointConfig().configured,
    runs: runs.rows,
    warning: [warning, runs.warning].filter(Boolean).join(' / '),
  };
}

export async function GET(request) {
  const denied = requireTabPermission(request, 'weeklyReports');
  if (denied) return denied;
  try {
    return Response.json(await buildPayload(getSupabaseAdmin()));
  } catch (error) {
    return Response.json({ error: error.message || '자동 발송 설정 조회 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'weeklyReports');
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';

    if (action === 'save') {
      const { settings: current } = await getReportSendSettings(supabase);
      const next = normalizeWeeklyAutoSendSettings({ ...current.weeklyAutoSend, ...(body.settings || {}) });
      if (!/^\d{2}:\d{2}$/.test(String(body.settings?.time ?? next.time))) {
        return Response.json({ error: '실행 시각은 HH:MM 형식으로 입력하세요.' }, { status: 400 });
      }
      await saveReportSendSettings(supabase, { ...current, weeklyAutoSend: next });
      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.auto_send.settings',
        targetType: 'system_settings',
        targetName: 'weeklyAutoSend',
        payload: next,
      });
      const payload = await buildPayload(supabase);
      return Response.json({ ...payload, message: next.enabled ? `자동 발송을 켰습니다. ${payload.description}` : '자동 발송을 껐습니다. 설정값은 저장돼 있습니다.' });
    }

    if (action === 'run_now') {
      const start = String(body.weekStart || '').slice(0, 10);
      const end = String(body.weekEnd || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return Response.json({ error: 'weekStart, weekEnd 가 필요합니다.' }, { status: 400 });
      }
      const result = await runWeeklyReportAuto({ supabase, force: true, week: { start, end }, trigger: 'manual', actorName });
      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.auto_send.run_now',
        targetType: 'weekly_report',
        targetName: `${start} ~ ${end}`,
        payload: { ok: result.ok, status: result.status, compose: result.compose || null, send: result.send ? { ...result.send, details: undefined } : null, error: result.error || null },
      });
      const payload = await buildPayload(supabase);
      return Response.json({ ...payload, result, message: result.ok ? result.message : `실행 실패: ${result.error}` }, { status: result.ok ? 200 : 500 });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || '자동 발송 처리 실패' }, { status: 500 });
  }
}
