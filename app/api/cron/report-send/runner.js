// Beyond OS v41-158
// 예약된 리포트 발송을 실제로 처리하는 실행기입니다.
//
// Cron(/api/cron/report-send)과 화면의 [지금 실행]이 같은 함수를 씁니다.
//
// 발송 자체는 기존 발송 라우트를 그대로 호출합니다.
// 수신자 결정·중복 발송 방지·발송 로그 기록 규칙이 즉시 발송과 완전히 같아야 하고,
// 그 규칙을 여기서 다시 구현하면 두 곳이 어긋나기 때문입니다.

import { POST as sendDailyReport } from '../../report-send/route';
import { POST as sendWeeklyReport } from '../../weekly-report-send/route';
import { sendSlackText } from '../../../../lib/slackNotify';
import { formatScheduleTime } from '../../../../lib/reportSchedules';

// 한 번에 처리할 예약 수. 한 예약 안의 대상 수는 별도로 제한하지 않습니다.
const MAX_SCHEDULES_PER_RUN = 5;
// 알림톡 발송이 몰리지 않도록 대상 사이에 짧게 쉽니다.
const SEND_GAP_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 내부에서 발송 라우트를 호출할 때 쓸 요청을 만듭니다.
 * ADMIN_PASSWORD가 설정돼 있으면 그 헤더로 통과하고,
 * 설정돼 있지 않은 환경(로컬/프리뷰)에서는 인증 폴백이 동작합니다.
 */
function buildInternalRequest(payload) {
  const headers = { 'content-type': 'application/json' };
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (adminPassword) headers['x-admin-password'] = adminPassword;
  return new Request('http://internal/api/report-send', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

async function sendOneTarget(reportType, target, actorName) {
  const payload = reportType === 'weekly'
    ? { action: 'send', reportId: target.id, adminName: actorName }
    : { action: 'send', sessionId: target.id, adminName: actorName };

  const handler = reportType === 'weekly' ? sendWeeklyReport : sendDailyReport;
  try {
    const response = await handler(buildInternalRequest(payload));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { id: target.id, studentName: target.studentName, ok: false, error: data?.error || `HTTP ${response.status}`, status: data?.skipped ? 'skipped' : 'failed' };
    }
    // v41-292: 슬랙 요약용으로 제공자 상태(발송 완료 / 발송대기)를 함께 남깁니다.
    const providerStatus = String(data?.report?.send_status || data?.status || '').toLowerCase();
    const status = ['failed', 'error'].includes(providerStatus) ? 'failed' : ['ready', 'queued', 'accepted'].includes(providerStatus) ? 'ready' : 'sent';
    return { id: target.id, studentName: target.studentName, ok: status !== 'failed', status, message: data?.message || '', error: status === 'failed' ? (data?.message || data?.report?.send_error || '발송 실패') : '' };
  } catch (error) {
    return { id: target.id, studentName: target.studentName, ok: false, error: error?.message || '발송 중 오류' };
  }
}

async function processSchedule(supabase, schedule, actorName) {
  const targets = Array.isArray(schedule.targets) ? schedule.targets : [];
  const details = [];
  let sent = 0;
  let failed = 0;

  let ready = 0;
  for (const target of targets) {
    const result = await sendOneTarget(schedule.report_type, target, actorName);
    details.push(result);
    // v41-292.1: '발송 완료'와 '발송대기(제공자 접수)'를 따로 셉니다. 전에는 대기 건이 완료에도 함께 세어졌습니다.
    if (!result.ok) failed += 1;
    else if (result.status === 'ready') ready += 1;
    else sent += 1;
    if (SEND_GAP_MS) await sleep(SEND_GAP_MS);
  }

  // 한 건이라도 접수됐으면(완료 또는 대기) done으로 둡니다. 전부 실패한 경우만 failed입니다.
  // (일부 실패를 failed로 두면 재실행 시 성공분까지 다시 보내게 됩니다)
  const status = sent + ready > 0 ? 'done' : 'failed';
  const skipped = details.filter((item) => item.status === 'skipped').length;
  const summary = { sent, failed, ready, skipped, accepted: sent + ready, total: targets.length, details };

  const { data: updated } = await supabase
    .from('report_send_schedules')
    .update({
      status,
      result: summary,
      last_error: failed ? (details.find((item) => !item.ok)?.error || '일부 발송 실패') : null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', schedule.id)
    .select()
    .single();

  // v41-292: 예약 발송 결과를 슬랙(비욘드 봇)으로 알립니다. 슬랙 설정이 없으면 조용히 건너뜁니다.
  const slack = await sendSlackText(buildScheduleSlackSummary({ schedule, summary, status, actorName })).catch((error) => ({ ok: false, message: error?.message || '슬랙 발송 오류' }));

  return { id: schedule.id, status, ...summary, slack, row: updated || null };
}

/**
 * v41-292: 예약 발송 결과 슬랙 메시지. (테스트할 수 있게 순수 함수)
 *   제목: 데일리 리포트 예약 발송 결과 · 11/12(수) 19:30
 *   본문: 대상 24명 · 발송 완료 22 · 발송대기 0 · 실패 2
 *         실패: 김민준(학부모 연락처가 없습니다.), …
 */
export function buildScheduleSlackSummary({ schedule = {}, summary = {}, status = 'done', actorName = '예약 발송' }) {
  const typeLabel = schedule.report_type === 'weekly' ? '위클리 리포트' : '데일리 리포트';
  const when = formatScheduleTime(schedule.scheduled_at);
  const title = `${typeLabel} 예약 발송 결과 · ${when}`;
  const counts = `대상 ${summary.total || 0}명 · 발송 완료 ${summary.sent || 0}${summary.ready ? ` · 발송대기 ${summary.ready}` : ''} · 실패 ${summary.failed || 0}${summary.skipped ? ` (미발송 제외 ${summary.skipped} 포함)` : ''}`;
  // 발송대기 = 발송 서버(솔라피)가 요청을 접수한 상태. 실제 도착 여부는 나중에 카카오 결과로 갱신됩니다.
  const readyNote = summary.ready ? '발송대기는 발송 서버가 접수한 건입니다. 실제 도착 결과는 설정 › 알림톡 발송 이력에서 확인하세요.' : '';
  const failedRows = (summary.details || []).filter((item) => !item.ok);
  const failedText = failedRows.length
    ? `실패: ${failedRows.slice(0, 15).map((item) => `${item.studentName || '학생'}(${String(item.error || item.message || '사유 없음').replace(/\s+/g, ' ').slice(0, 40)})`).join(', ')}${failedRows.length > 15 ? ` 외 ${failedRows.length - 15}명` : ''}`
    : '';
  const lines = [schedule.label ? `예약: ${schedule.label}` : '', counts, failedText, readyNote].filter(Boolean);
  const footer = `상태: ${status === 'done' ? '완료' : '실패'} · 예약자: ${schedule.created_by || '-'} · 실행: ${actorName}`;
  const icon = status === 'done' ? (failedRows.length ? ':warning:' : ':white_check_mark:') : ':x:';
  return {
    text: `[${title}]\n${lines.join('\n')}\n${footer}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `${icon} ${lines.join('\n')}`.slice(0, 2900) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
    ],
  };
}

/**
 * 보낼 때가 된 예약을 처리합니다.
 *
 * @param {Object}  options
 * @param {Object}  options.supabase
 * @param {string}  [options.scheduleId]     특정 예약만 처리
 * @param {boolean} [options.ignoreSchedule] 예약 시각을 무시하고 바로 실행 ([지금 실행]용)
 * @param {string}  [options.actorName]
 */
export async function runDueReportSchedules({ supabase, scheduleId = '', ignoreSchedule = false, actorName = '예약 발송' }) {
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('report_send_schedules')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(MAX_SCHEDULES_PER_RUN);
  if (scheduleId) query = query.eq('id', scheduleId);
  if (!ignoreSchedule) query = query.lte('scheduled_at', nowIso);

  const { data: due, error } = await query;
  if (error) throw error;

  if (!due || !due.length) {
    return { ok: true, picked: 0, processed: [], message: '지금 보낼 예약이 없습니다.' };
  }

  const processed = [];
  for (const schedule of due) {
    // pending → processing 을 조건부로 바꿔, Cron이 겹쳐 돌아도 한 번만 잡습니다.
    const { data: claimed } = await supabase
      .from('report_send_schedules')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        attempts: Number(schedule.attempts || 0) + 1,
      })
      .eq('id', schedule.id)
      .eq('status', 'pending')
      .select()
      .single();

    // 다른 실행이 먼저 가져갔으면 건너뜁니다.
    if (!claimed) continue;

    try {
      processed.push(await processSchedule(supabase, claimed, actorName));
    } catch (runError) {
      await supabase
        .from('report_send_schedules')
        .update({
          status: 'failed',
          last_error: String(runError?.message || runError).slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq('id', schedule.id);
      processed.push({ id: schedule.id, status: 'failed', sent: 0, failed: 0, error: String(runError?.message || runError) });
    }
  }

  const totalSent = processed.reduce((sum, item) => sum + Number(item.sent || 0), 0);
  const totalFailed = processed.reduce((sum, item) => sum + Number(item.failed || 0), 0);

  return {
    ok: true,
    picked: processed.length,
    processed,
    totalSent,
    totalFailed,
    message: processed.length
      ? `예약 ${processed.length}건 처리 · 발송 ${totalSent}건${totalFailed ? ` · 실패 ${totalFailed}건` : ''}`
      : '처리할 예약이 없습니다.',
  };
}
