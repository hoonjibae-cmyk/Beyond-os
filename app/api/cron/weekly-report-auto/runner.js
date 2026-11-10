// Beyond OS v41-287
// 위클리 리포트 자동 생성·발송 실행기입니다.
//
// Cron(/api/cron/weekly-report-auto, 10분마다)과 화면의 [지금 실행]이 같은 함수를 씁니다.
//
// 처리 순서
//   1. 설정(weeklyAutoSend)을 읽고 지금이 실행 시각인지 봅니다. (force 면 건너뜀)
//   2. 보낼 주(월~일)를 정하고 weekly_report_auto_runs 에 실행 기록을 선점합니다.
//      같은 주는 자동으로 한 번만 처리됩니다. (크론이 겹쳐 돌아도 run_key 유일 제약이 막음)
//   3. 리포트 자동 구성: 기존 일괄 구성 라우트(/api/weekly-report-bulk-compose)를 그대로 호출합니다.
//   4. 그 주 리포트 중 본문이 있고 아직 발송 완료(sent)가 아닌 것만 기존 발송 라우트로 한 명씩 보냅니다.
//      수신자 결정·테스트모드·중복 방지·발송 로그는 수동 발송과 완전히 같습니다.
//   5. 결과를 실행 기록에 남기고, 설정돼 있으면 슬랙으로 요약을 알립니다.

import { POST as bulkComposeWeekly } from '../../weekly-report-bulk-compose/route';
import { POST as sendWeeklyReport } from '../../weekly-report-send/route';
import { getReportSendSettings } from '../../../../lib/reportSendSettings';
import { getCohortIdFromRequest, resolveScopeCohort, loadCohortStudentIds } from '../../../../lib/cohortScope';
import { getKstDateString } from '../../../../lib/date';
import { selectInChunksSafe } from '../../../../lib/supabaseChunk';
import { findWeeklyInactiveStudentIds } from '../../../../lib/weeklyActivity';
import { sendSlackText } from '../../../../lib/slackNotify';
import {
  normalizeWeeklyAutoSendSettings, isWeeklyAutoSendDue, getKstNowParts, resolveTargetWeek, buildAutoRunKey, WEEKDAY_LABELS_KO,
} from '../../../../lib/weeklyAutoSend';

export const AUTO_RUNS_TABLE = 'weekly_report_auto_runs';
export const AUTO_RUNS_SQL_HINT = 'beyond-os-supabase-weekly-report-auto-runs-v41-287.sql 을 먼저 실행하세요. (weekly_report_auto_runs 표 없음)';
const SEND_GAP_MS = 250;
// 실패한 자동 실행은 이 시간이 지나면 다음 크론에서 한 번 더 시도합니다.
const RETRY_FAILED_AFTER_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

export function isAutoRunsTableMissing(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || (message.includes(AUTO_RUNS_TABLE) && (message.includes('does not exist') || message.includes('schema cache')));
}

/** 내부에서 기존 라우트를 호출할 때 쓰는 요청. ADMIN_PASSWORD 가 있으면 그 헤더로 통과합니다. */
function buildInternalRequest(path, payload) {
  const headers = { 'content-type': 'application/json' };
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (adminPassword) headers['x-admin-password'] = adminPassword;
  return new Request(`http://internal${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
}

function formatWeek(week) {
  const label = (d) => `${d.slice(5).replace('-', '/')}`;
  return `${label(week.start)}~${label(week.end)}`;
}

async function composeReports({ week, composeMode, actorName }) {
  const response = await bulkComposeWeekly(buildInternalRequest('/api/weekly-report-bulk-compose', {
    startDate: week.start, endDate: week.end, mode: composeMode, createdBy: actorName,
  }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `리포트 자동 구성 실패 (HTTP ${response.status})`);
  return {
    mode: composeMode,
    ...(data.summary || {}),
    failedStudents: (data.results || []).filter((row) => !row.ok).slice(0, 20).map((row) => ({ name: row.studentName, error: row.error })),
  };
}

/** 그 주 리포트 중 "본문 있음 · 기수 명단 · 활성 · 아직 sent 아님" */
export async function pickSendTargets(supabase, week) {
  const { data: reports, error } = await supabase
    .from('weekly_reports')
    .select('id, student_id, send_status, report_text')
    .eq('start_date', week.start)
    .eq('end_date', week.end);
  if (error) throw error;

  const studentIds = [...new Set((reports || []).map((row) => row.student_id).filter(Boolean))];
  const studentMap = {};
  if (studentIds.length) {
    const students = await selectInChunksSafe(studentIds, (part) => supabase.from('students').select('id,name,status').in('id', part));
    for (const student of students.rows || []) studentMap[String(student.id)] = student;
  }

  let inCohort = null;
  try {
    const cohort = await resolveScopeCohort(supabase, getCohortIdFromRequest(new Request('http://internal/')), getKstDateString());
    if (cohort) inCohort = new Set((await loadCohortStudentIds(supabase, cohort.id)) || []);
  } catch { inCohort = null; }

  // v41-288: 그 주 개인 시간표가 없고 등원 기록도 없는 학생은 미발송 대상입니다.
  const activity = await findWeeklyInactiveStudentIds(supabase, studentIds, week);

  const targets = [];
  const skipped = { noText: 0, alreadySent: 0, inactive: 0, outOfCohort: 0, noActivity: 0, noActivityNames: [] };
  for (const report of reports || []) {
    const student = studentMap[String(report.student_id)];
    if (!String(report.report_text || '').trim()) { skipped.noText += 1; continue; }
    if (String(report.send_status || '').toLowerCase() === 'sent') { skipped.alreadySent += 1; continue; }
    if (!student || student.status === 'inactive') { skipped.inactive += 1; continue; }
    if (inCohort && !inCohort.has(String(report.student_id))) { skipped.outOfCohort += 1; continue; }
    if (activity.inactiveIds.has(String(report.student_id))) { skipped.noActivity += 1; skipped.noActivityNames.push(student.name || '학생'); continue; }
    targets.push({ reportId: report.id, studentId: report.student_id, studentName: student.name || '학생' });
  }
  if (activity.warning) skipped.activityWarning = activity.warning;
  targets.sort((a, b) => String(a.studentName).localeCompare(String(b.studentName), 'ko'));
  return { targets, skipped };
}

export function classifySendResult(data) {
  const status = String(data?.report?.send_status || data?.status || '').toLowerCase();
  if (!data || data.ok === false || status === 'failed' || status === 'error') return 'failed';
  if (['ready', 'queued', 'accepted'].includes(status)) return 'ready';
  return 'sent';
}

async function sendReports({ targets, actorName, recipientTarget = 'parent' }) {
  const details = [];
  for (const target of targets) {
    try {
      const response = await sendWeeklyReport(buildInternalRequest('/api/weekly-report-send', { action: 'send', reportId: target.reportId, adminName: actorName, recipientTarget }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) details.push({ ...target, status: 'failed', message: data?.error || `HTTP ${response.status}` });
      else details.push({ ...target, status: classifySendResult(data), message: data?.message || '' });
    } catch (error) {
      details.push({ ...target, status: 'failed', message: error?.message || '발송 중 오류' });
    }
    if (SEND_GAP_MS) await sleep(SEND_GAP_MS);
  }
  return {
    total: targets.length,
    sent: details.filter((d) => d.status === 'sent').length,
    ready: details.filter((d) => d.status === 'ready').length,
    failed: details.filter((d) => d.status === 'failed').length,
    details,
  };
}

/** 실행 기록 선점. 이미 처리한 주면 null. 실패 뒤 30분이 지났으면 재시도로 선점. */
export async function claimRun(supabase, { runKey, trigger, week, settings, actorName }) {
  const { data: inserted, error } = await supabase
    .from(AUTO_RUNS_TABLE)
    .insert({ run_key: runKey, trigger, week_start: week.start, week_end: week.end, status: 'processing', settings_snapshot: settings, triggered_by: actorName })
    .select()
    .single();
  if (!error) return inserted;
  if (isAutoRunsTableMissing(error)) throw new Error(AUTO_RUNS_SQL_HINT);
  if (error.code !== '23505') throw error;

  // 같은 run_key 가 있음: 실패한 지 오래된 건만 다시 잡습니다.
  const { data: existing } = await supabase.from(AUTO_RUNS_TABLE).select('*').eq('run_key', runKey).maybeSingle();
  if (!existing || existing.status !== 'failed') return null;
  if (Number(existing.attempts || 1) >= MAX_ATTEMPTS) return null;
  if (existing.finished_at && Date.now() - new Date(existing.finished_at).getTime() < RETRY_FAILED_AFTER_MS) return null;
  const { data: reclaimed } = await supabase
    .from(AUTO_RUNS_TABLE)
    .update({ status: 'processing', started_at: new Date().toISOString(), finished_at: null, attempts: Number(existing.attempts || 1) + 1, last_error: null })
    .eq('id', existing.id)
    .eq('status', 'failed')
    .select()
    .single();
  return reclaimed || null;
}

async function finishRun(supabase, runId, patch) {
  try {
    const { data } = await supabase.from(AUTO_RUNS_TABLE).update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId).select().single();
    return data || null;
  } catch { return null; }
}

function buildSlackSummary({ week, trigger, compose, send, error }) {
  const title = `위클리 리포트 자동 발송 · ${formatWeek(week)}`;
  if (error) {
    return { text: `[${title}] 실패: ${error}`, blocks: [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `:x: 실행 실패\n${error}` } },
    ] };
  }
  const targetLabel = { parent: '학부모', student: '학생', both: '학부모+학생' }[send?.recipientTarget] || '학부모';
  const lines = [
    `리포트 구성: 신규 ${compose?.created || 0} · 갱신 ${compose?.updated || 0} · 건너뜀 ${compose?.skipped || 0} · 실패 ${compose?.failed || 0}`,
    `알림톡 발송(${targetLabel}): 대상 ${send?.total || 0}명 · 발송 ${send?.sent || 0} · 대기 ${send?.ready || 0} · 실패 ${send?.failed || 0}`,
  ];
  if (send?.skipped?.noActivity) lines.push(`미발송(시간표·등원 기록 없음): ${send.skipped.noActivity}명${send.skipped.noActivityNames?.length ? ` · ${send.skipped.noActivityNames.slice(0, 12).join(', ')}${send.skipped.noActivityNames.length > 12 ? ' 외' : ''}` : ''}`);
  const failedNames = (send?.details || []).filter((d) => d.status === 'failed').map((d) => `${d.studentName}(${String(d.message || '').slice(0, 40)})`);
  if (failedNames.length) lines.push(`실패 학생: ${failedNames.slice(0, 15).join(', ')}${failedNames.length > 15 ? ` 외 ${failedNames.length - 15}명` : ''}`);
  const text = `[${title}]\n${lines.join('\n')}\n실행: ${trigger === 'auto' ? '시스템(예약)' : '관리자 수동'}`;
  return { text, blocks: [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `실행: ${trigger === 'auto' ? '시스템(예약)' : '관리자 수동'}` }] },
  ] };
}

/**
 * @param {Object}  options
 * @param {Object}  options.supabase
 * @param {boolean} [options.force]      실행 시각·켜짐 여부를 무시하고 바로 실행 ([지금 실행])
 * @param {Object}  [options.week]       force 때 보낼 주 { start, end }. 없으면 설정의 weekTarget 으로 계산
 * @param {string}  [options.trigger]    'auto' | 'manual'
 * @param {string}  [options.actorName]
 */
export async function runWeeklyReportAuto({ supabase, force = false, week: weekOverride = null, trigger = 'auto', actorName = '자동 발송' }) {
  const { settings: allSettings } = await getReportSendSettings(supabase);
  const settings = normalizeWeeklyAutoSendSettings(allSettings.weeklyAutoSend);
  const nowParts = getKstNowParts();

  if (!force) {
    if (!settings.enabled) return { ok: true, skipped: true, reason: 'disabled', message: '위클리 자동 발송이 꺼져 있습니다.' };
    if (!isWeeklyAutoSendDue(settings, nowParts)) {
      return { ok: true, skipped: true, reason: 'not_due', message: `아직 실행 시각이 아닙니다. (매주 ${WEEKDAY_LABELS_KO[settings.weekday]} ${settings.time})` };
    }
  }

  const week = weekOverride?.start && weekOverride?.end ? weekOverride : resolveTargetWeek(nowParts.date, settings.weekTarget);
  if (!week.start || !week.end) return { ok: false, error: '보낼 주를 정하지 못했습니다.' };

  const runKey = buildAutoRunKey(week, trigger);
  const run = await claimRun(supabase, { runKey, trigger, week, settings, actorName });
  if (!run) return { ok: true, skipped: true, reason: 'already_done', week, message: `${formatWeek(week)} 주는 이미 자동 처리했습니다.` };

  let compose = null;
  let send = null;
  try {
    compose = await composeReports({ week, composeMode: settings.composeMode, actorName });
    const picked = await pickSendTargets(supabase, week);
    send = { ...(await sendReports({ targets: picked.targets, actorName, recipientTarget: settings.recipientTarget })), skipped: picked.skipped, recipientTarget: settings.recipientTarget };
    // 대상이 있었는데 전부 실패하면 failed (30분 뒤 재시도). 대상 0명은 정상 종료입니다.
    const status = send.total > 0 && send.sent === 0 && send.ready === 0 ? 'failed' : 'done';
    const row = await finishRun(supabase, run.id, {
      status, compose_summary: compose, send_summary: send,
      last_error: status === 'failed' ? (send.details.find((d) => d.status === 'failed')?.message || '전체 발송 실패') : null,
    });
    if (settings.notifySlack) await sendSlackText(buildSlackSummary({ week, trigger, compose, send })).catch(() => {});
    return {
      ok: true, status, week, trigger, compose, send, run: row,
      message: `${formatWeek(week)} · 구성 신규 ${compose.created || 0}·갱신 ${compose.updated || 0} · 발송 ${send.sent}명${send.ready ? ` · 대기 ${send.ready}` : ''}${send.failed ? ` · 실패 ${send.failed}` : ''}${send.skipped?.noActivity ? ` · 미발송(시간표·등원 없음) ${send.skipped.noActivity}` : ''}${send.total === 0 ? ' · 보낼 대상 없음' : ''}`,
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    const row = await finishRun(supabase, run.id, { status: 'failed', compose_summary: compose, send_summary: send, last_error: message });
    if (settings.notifySlack) await sendSlackText(buildSlackSummary({ week, trigger, error: message })).catch(() => {});
    return { ok: false, status: 'failed', week, trigger, error: message, run: row };
  }
}

/** 화면용: 최근 실행 기록 */
export async function loadRecentAutoRuns(supabase, limit = 10) {
  try {
    // v41-289: 주간 순공 슬랙 알림 실행 기록(trigger=study_alert)은 이 표를 함께 쓰지만 위클리 패널에는 보이지 않습니다.
    const { data, error } = await supabase.from(AUTO_RUNS_TABLE).select('*').neq('trigger', 'study_alert').order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    if (isAutoRunsTableMissing(error)) return { rows: [], warning: AUTO_RUNS_SQL_HINT };
    return { rows: [], warning: error?.message || '실행 기록을 읽지 못했습니다.' };
  }
}
