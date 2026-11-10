// Beyond OS v41-289
// 주간 순공시간 부족 학생 슬랙 알림 실행기.
//
// Cron(/api/cron/weekly-study-alert, 10분마다)과 화면의 [지금 보내기]가 같은 함수를 씁니다.
//   1. 자동 상점 기준의 weeklyStudyAlert* 설정을 읽고 지금이 보낼 때인지 봅니다. (force 면 건너뜀)
//   2. 지난 주(월~일)와 기수 명단을 정하고, 주간 자동 상점 배치와 같은 계산으로 학생별 순공시간을 냅니다.
//   3. 기준 미만 학생을 골라 슬랙(비욘드 봇, SLACK_POINT_CHANNEL)으로 보냅니다.
//   4. weekly_report_auto_runs 에 run_key 'study_alert:주' 로 기록해 같은 주를 두 번 보내지 않습니다.

import { getPointAutoRules } from '../../../../lib/pointAutoRulesServer';
import { getPreviousWeekRange } from '../../../../lib/pointAutoRules';
import { loadCohortRange } from '../../../../lib/cohortScope';
import { getKstDateString } from '../../../../lib/date';
import { getSlackPointConfig, sendSlackText } from '../../../../lib/slackNotify';
import { getKstNowParts } from '../../../../lib/weeklyAutoSend';
import { isWeeklyStudyAlertDue, pickBelowThreshold, buildWeeklyStudyAlertMessage, describeWeeklyStudyAlert } from '../../../../lib/weeklyStudyAlert';
import { loadTargetStudents, loadWeeklyStudyMinutes } from '../weekly-points/runner';
import { AUTO_RUNS_TABLE, AUTO_RUNS_SQL_HINT, isAutoRunsTableMissing } from '../weekly-report-auto/runner';

const TRIGGER = 'study_alert';

async function claimAlertRun(supabase, { week, force, settingsSnapshot, actorName }) {
  // 수동 실행은 매번 새 기록, 자동 실행은 주당 한 번입니다.
  const runKey = force ? `${TRIGGER}:${week.start}~${week.end}:${Date.now()}` : `${TRIGGER}:${week.start}~${week.end}`;
  const { data, error } = await supabase
    .from(AUTO_RUNS_TABLE)
    .insert({ run_key: runKey, trigger: TRIGGER, week_start: week.start, week_end: week.end, status: 'processing', settings_snapshot: settingsSnapshot, triggered_by: actorName })
    .select()
    .single();
  if (!error) return { run: data, missingTable: false };
  if (isAutoRunsTableMissing(error)) return { run: null, missingTable: true };
  if (error.code === '23505') return { run: null, duplicate: true };
  throw error;
}

async function finishAlertRun(supabase, runId, patch) {
  if (!runId) return;
  try { await supabase.from(AUTO_RUNS_TABLE).update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId); } catch {}
}

/**
 * @param {Object}  options
 * @param {Object}  options.supabase
 * @param {boolean} [options.force]     설정·시각과 무관하게 지금 보냄 ([지금 보내기])
 * @param {string}  [options.runDate]   기준일(YYYY-MM-DD). 지난 주는 이 날짜 기준. 기본 오늘
 * @param {string}  [options.actorName]
 */
export async function runWeeklyStudyAlert({ supabase, force = false, runDate: requestedRunDate = '', actorName = '시스템' }) {
  const rules = await getPointAutoRules(supabase);
  const nowParts = getKstNowParts();
  if (!force) {
    if (!rules.weeklyStudyAlertEnabled) return { ok: true, skipped: true, reason: 'disabled', message: '주간 순공 슬랙 알림이 꺼져 있습니다.' };
    if (!isWeeklyStudyAlertDue(rules, nowParts)) return { ok: true, skipped: true, reason: 'not_due', message: `아직 보낼 시각이 아닙니다. (${describeWeeklyStudyAlert(rules)})` };
  }

  const slack = getSlackPointConfig();
  if (!slack.configured) {
    return { ok: false, error: '슬랙 설정이 없습니다. Vercel 환경변수 SLACK_POINT_WEBHOOK_URL 또는 SLACK_BOT_TOKEN(+SLACK_POINT_CHANNEL)을 넣어 주세요.' };
  }

  const runDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedRunDate || '')) ? String(requestedRunDate) : nowParts.date || getKstDateString();
  const week = getPreviousWeekRange(runDate);
  const settingsSnapshot = {
    minHours: rules.weeklyStudyAlertMinHours, weekday: rules.weeklyStudyAlertWeekday, time: rules.weeklyStudyAlertTime, channel: slack.channel, mode: slack.mode,
  };

  // 실행 기록 표가 없어도(SQL 미실행) 알림 자체는 보냅니다. 다만 자동 실행은 중복을 막을 수 없어 건너뜁니다.
  const claim = await claimAlertRun(supabase, { week, force, settingsSnapshot, actorName });
  if (claim.duplicate) return { ok: true, skipped: true, reason: 'already_done', week, message: `${week.start}~${week.end} 주 알림은 이미 보냈습니다.` };
  if (claim.missingTable && !force) return { ok: false, skipped: true, reason: 'missing_table', error: `자동 실행은 중복 방지 기록이 필요합니다. ${AUTO_RUNS_SQL_HINT}` };
  const runId = claim.run?.id || null;

  try {
    const cohortRange = await loadCohortRange(supabase, '', runDate);
    const { students } = await loadTargetStudents(supabase, cohortRange);
    const studentIds = students.map((row) => String(row.id));
    const { minutesByStudent } = studentIds.length ? await loadWeeklyStudyMinutes(supabase, week, studentIds) : { minutesByStudent: {} };
    const rows = pickBelowThreshold(students, minutesByStudent, rules.weeklyStudyAlertMinHours);
    const message = buildWeeklyStudyAlertMessage({ week, minHours: rules.weeklyStudyAlertMinHours, rows, totalStudents: students.length, cohortName: cohortRange?.name || '' });
    const sent = await sendSlackText(message);
    const summary = { week, minHours: rules.weeklyStudyAlertMinHours, totalStudents: students.length, below: rows.length, rows, slack: sent, headline: message.headline, cohort: cohortRange ? { id: cohortRange.id, name: cohortRange.name } : null };
    if (!sent.ok) {
      await finishAlertRun(supabase, runId, { status: 'failed', send_summary: summary, last_error: sent.message || '슬랙 발송 실패' });
      return { ok: false, status: 'failed', week, error: sent.message || '슬랙 발송 실패', summary };
    }
    await finishAlertRun(supabase, runId, { status: 'done', send_summary: summary });
    return { ok: true, status: 'done', week, summary, message: `${week.start}~${week.end} · 대상 ${students.length}명 중 ${rows.length}명 슬랙 발송 완료` };
  } catch (error) {
    const text = String(error?.message || error).slice(0, 500);
    await finishAlertRun(supabase, runId, { status: 'failed', last_error: text });
    return { ok: false, status: 'failed', week, error: text };
  }
}
