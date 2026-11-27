import test from 'node:test';
import assert from 'node:assert/strict';
import { getReportDateConfirmation, validateDailySchedule, kstDateTimeToIso } from '../lib/reportSchedules.js';
import { getReportAttemptStatus, getScheduleOutcome, summarizeReportSchedule, normalizeReportActivityLogs } from '../lib/reportDelivery.js';

const now = new Date('2026-11-27T12:00:00+09:00');
const scheduledAt = '2026-11-27T22:10:00+09:00';
const legacyDuplicate = '동일 idempotencyKey 요청이 이미 실제 제공자에 접수되어 중복 발송하지 않았습니다.';
const row = (status, index = 0) => ({ id: String(index), studentName: `가상 학생 ${index}`, status, ok: status !== 'failed' });

test('11/26 regression: 17 handled duplicates plus 4 accepted is not 21 sends', () => {
  const details = [...Array.from({ length: 17 }, (_, i) => ({ ...row('ready', i), message: legacyDuplicate })), ...Array.from({ length: 4 }, (_, i) => row('ready', i + 17))];
  const summary = summarizeReportSchedule({ ready: 21, accepted: 21, details });
  assert.equal(summary.duplicate, 17);
  assert.equal(summary.accepted, 4);
  assert.equal(summary.failed, 0);
  assert.equal(summary.sent, 0);
  assert.equal(getScheduleOutcome({ status: 'done', result: summary }).tone, 'duplicate');
  assert.equal(summarizeReportSchedule(summary).accepted, 4);
});

test('11/25 regression: 6 accepted, 11 missing reports is visibly partial failure', () => {
  const result = { details: [...Array.from({ length: 6 }, (_, i) => row('ready', i)), ...Array.from({ length: 11 }, (_, i) => ({ ...row('failed', i + 6), error: '먼저 데일리 리포트를 생성하세요.' }))] };
  const outcome = getScheduleOutcome({ status: 'done', result });
  assert.equal(outcome.label, '일부 실패');
  assert.equal(outcome.summary.accepted, 6);
  assert.equal(outcome.summary.failed, 11);
});

test('all duplicates and skipped attempts never count as sends or failed sends', () => {
  const result = summarizeReportSchedule({ details: [row('duplicate'), { ...row('skipped', 1), ok: false }] });
  assert.equal(result.accepted, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.duplicate, 1);
  assert.equal(result.skipped, 1);
  assert.equal(getScheduleOutcome({ status: 'done', result: { details: [row('duplicate')] } }).label, '중복 차단 · 미발송');
});

test('an old sent report does not override the new attempt duplicate flag', () => {
  assert.equal(getReportAttemptStatus({ ok: true, duplicate: true, report: { send_status: 'sent' } }), 'duplicate');
  assert.equal(getReportAttemptStatus({ ok: true, providerResult: { response: { duplicate: true } }, report: { send_status: 'ready' } }), 'duplicate');
  assert.equal(getReportAttemptStatus({ ok: true, report: { send_status: 'ready' } }), 'ready');
  assert.equal(getReportAttemptStatus({ ok: false, report: { send_status: 'ready' } }), 'failed');
});

test('legacy activity requires matching key, request and close timestamp; real original send remains done', () => {
  const base = { idempotencyKey: 'daily:fake:recipient', requestId: 'original' };
  const logs = [
    { id: 'original-send', action_type: 'daily_report.send', created_at: '2026-11-25T13:00:00Z', payload: base },
    { id: 'diagnostic', action_type: 'kakao_webhook.duplicate', created_at: '2026-11-26T13:00:00Z', payload: { idempotencyKey: base.idempotencyKey, previousLogId: 'original' } },
    { id: 'blocked-send', action_type: 'daily_report.send', created_at: '2026-11-26T13:00:01Z', payload: base },
    { id: 'different-key', action_type: 'daily_report.send', created_at: '2026-11-26T13:00:01Z', payload: { ...base, idempotencyKey: 'different' } },
    { id: 'later', action_type: 'daily_report.send', created_at: '2026-11-26T14:00:00Z', payload: base },
  ];
  const normalized = normalizeReportActivityLogs(logs);
  assert.equal(normalized[2].payload.duplicate, true);
  for (const index of [0, 3, 4]) assert.equal(normalized[index].payload.duplicate, undefined);
  assert.equal(logs[2].payload.duplicate, undefined);
});

test('same-day report needs no extra confirmation; old or future-send date does', () => {
  assert.equal(getReportDateConfirmation('2026-11-27', scheduledAt, now).required, false);
  assert.equal(getReportDateConfirmation('2026-11-26', scheduledAt, now).required, true);
  assert.equal(getReportDateConfirmation('2026-11-27', '2026-11-28T01:00:00+09:00', now).required, true);
  const midnight = new Date('2026-11-26T15:01:00Z');
  assert.equal(getReportDateConfirmation('2026-11-26', scheduledAt, midnight).today, '2026-11-27');
  assert.equal(kstDateTimeToIso('2026-11-27', '22:10'), '2026-11-27T13:10:00.000Z');
});

function database(sessions, reports = []) {
  return { from: (table) => ({ select: () => ({ in: async () => ({ data: table === 'daily_sessions' ? sessions : reports, error: null }) }) }) };
}
const targets = [{ id: 's1', studentName: '가상 학생' }];
const args = { targets, reportDate: '2026-11-27', scheduledAt };
const sessions = [{ id: 's1', session_date: '2026-11-27' }];
const reports = [{ session_id: 's1', report_text: '가상 리포트 본문' }];

test('server accepts prepared, verified same-day session', async () => {
  assert.equal((await validateDailySchedule(database(sessions, reports), args, now)).ok, true);
});
test('server rejects missing or mixed sessions and a forged period label/date', async () => {
  for (const rows of [[], [{ id: 's1', session_date: '2026-11-26' }], [...sessions, { id: 's2', session_date: '2026-11-26' }]]) {
    assert.equal((await validateDailySchedule(database(rows, reports), args, now)).code, 'REPORT_DATE_MISMATCH');
  }
});
test('server rejects unprepared and whitespace-only report bodies before queuing', async () => {
  for (const reportRows of [[], [{ session_id: 's1', report_text: '  ' }]]) {
    assert.equal((await validateDailySchedule(database(sessions, reportRows), args, now)).code, 'REPORT_NOT_READY');
  }
});
test('explicit old-report acknowledgement is bound to today, report date and send date', async () => {
  const oldArgs = { ...args, reportDate: '2026-11-26' };
  const db = database([{ id: 's1', session_date: oldArgs.reportDate }], reports);
  const rejected = await validateDailySchedule(db, oldArgs, now);
  assert.equal(rejected.code, 'REPORT_DATE_CONFIRMATION_REQUIRED');
  const acknowledged = { ...oldArgs, dateConfirmation: rejected.confirmation.key };
  assert.equal((await validateDailySchedule(db, acknowledged, now)).ok, true);
  assert.equal((await validateDailySchedule(db, { ...acknowledged, scheduledAt: '2026-11-28T22:10:00+09:00' }, now)).code, 'REPORT_DATE_CONFIRMATION_REQUIRED');
  assert.equal((await validateDailySchedule(db, acknowledged, new Date('2026-11-28T01:00:00+09:00'))).code, 'REPORT_DATE_CONFIRMATION_REQUIRED');
});
