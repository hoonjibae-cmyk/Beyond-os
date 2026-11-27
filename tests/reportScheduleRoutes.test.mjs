// node --experimental-vm-modules --test tests/reportScheduleRoutes.test.mjs
// Execute the real route code with in-memory data and a stubbed webhook.
// No Supabase, SOLAPI, Slack or other network access is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const student = { id: 'student-1', name: '가상 학생', parent_phone: '01000000000' };
const report = { id: 'report-1', session_id: 'session-1', student_id: student.id, report_date: '2026-11-27', report_text: '기존 리포트', send_status: 'sent', sent_at: '2026-11-27T01:00:00Z', sent_channel: 'solapi' };
const session = { id: 'session-1', student_id: student.id, session_date: report.report_date, seat_no: 1, seat_status: 'out', check_in_at: '2026-11-27T00:30:00Z', check_out_at: '2026-11-27T08:00:00Z', students: student };

function fakeDb(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  return { tables, writes, from(table) {
    const filters = [];
    let mutation;
    const run = (single = false) => {
      let rows = (tables[table] || []).filter((row) => filters.every((fn) => fn(row)));
      if (mutation) {
        writes.push({ table, ...mutation });
        if (mutation.type === 'update') rows.forEach((row) => Object.assign(row, mutation.value));
        else if (mutation.type === 'upsert') {
          const found = (tables[table] || []).find((row) => row.session_id === mutation.value.session_id);
          if (found) { Object.assign(found, mutation.value); rows = [found]; }
          else { rows = [{ id: 'new-report', ...mutation.value }]; tables[table] = [...(tables[table] || []), ...rows]; }
        } else { rows = [{ id: 'new-schedule', ...mutation.value }]; tables[table] = [...(tables[table] || []), ...rows]; }
      }
      return { data: single ? rows[0] || null : rows, error: null };
    };
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
      gte(key, value) { filters.push((row) => row[key] >= value); return this; },
      lte(key, value) { filters.push((row) => row[key] <= value); return this; },
      update(value) { mutation = { type: 'update', value }; return this; },
      insert(value) { mutation = { type: 'insert', value }; return this; },
      upsert(value) { mutation = { type: 'upsert', value }; return this; },
      single: async () => run(true), maybeSingle: async () => run(true),
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return query;
  } };
}

async function runtime(db, webhook = { ok: true, status: 'received', duplicate: true, requestId: 'original' }, extraMocks = {}) {
  const logs = [];
  const requests = [];
  const slack = [];
  const context = vm.createContext({
    Response, Request, URL, AbortController, console,
    process: { env: { REPORT_SEND_WEBHOOK_URL: 'https://stub.invalid/webhook' } },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json(webhook); },
  });
  const mocks = {
    'lib/supabaseAdmin.js': { getSupabaseAdmin: () => db },
    'lib/auth.js': { isAuthorized: () => true, getAuthorizedUser: () => ({ displayName: '가상 관리자' }), requireTabPermission: () => null, unauthorizedResponse: () => Response.json({}, { status: 401 }) },
    'lib/actionLog.js': { writeUserActionLog: async (_db, _req, log) => logs.push(log), cleanupOldUserActionLogs: async () => {} },
    'lib/reportShare.js': { ensureReportShareLink: async () => ({ url: 'https://example.invalid/r/fake', token: 'fake' }) },
    'lib/defaultScheduleServer.js': { getDefaultScheduleConfig: async () => ({}) },
    'lib/reportSendSettings.js': { getReportSendSettings: async () => ({ settings: {} }), isStudentRecipientEnabled: () => false },
    'lib/weeklyActivity.js': { isStudentInactiveForWeek: async () => ({ inactive: false }), WEEKLY_NO_ACTIVITY_CODE: 'INACTIVE', WEEKLY_NO_ACTIVITY_MESSAGE: '활동 없음' },
    'lib/slackNotify.js': { sendSlackText: async (message) => { slack.push(message); return { ok: true }; } },
    ...extraMocks,
  };
  const modules = new Map();
  async function load(relative) {
    const absolute = path.resolve(root, relative);
    if (modules.has(absolute)) return modules.get(absolute);
    const key = path.relative(root, absolute).replaceAll('\\', '/');
    const mock = mocks[key];
    const module = mock
      ? new vm.SyntheticModule(Object.keys(mock), function () { for (const [key, value] of Object.entries(mock)) this.setExport(key, value); }, { context, identifier: absolute })
      : new vm.SourceTextModule(await fs.readFile(absolute, 'utf8'), { context, identifier: absolute });
    modules.set(absolute, module);
    await module.link(async (specifier, importer) => {
      assert.ok(specifier.startsWith('.'), `No real dependency access: ${specifier}`);
      let next = path.resolve(path.dirname(importer.identifier), specifier);
      if (!path.extname(next)) next += '.js';
      return load(next);
    });
    return module;
  }
  return { logs, requests, slack, async route(file) { const module = await load(file); if (module.status !== 'evaluated') await module.evaluate(); return module.namespace; } };
}
const post = (body) => new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('real daily generation then duplicate send preserves original delivery metadata', async () => {
  const db = fakeDb({ daily_sessions: [session], daily_reports: [report] });
  const app = await runtime(db);
  const generate = await app.route('app/api/report/route.js');
  const generatedResponse = await generate.POST(post({ sessionId: session.id }));
  const generated = await generatedResponse.json();
  assert.equal(generatedResponse.status, 200, generated.error);
  assert.equal(generated.report.send_status, 'sent');
  assert.equal(generated.report.sent_at, report.sent_at);
  const writesBefore = db.writes.length;
  const send = await app.route('app/api/report-send/route.js');
  const response = await send.POST(post({ action: 'send', sessionId: session.id }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.status, 'duplicate');
  assert.equal(data.report.sent_at, report.sent_at);
  assert.equal(data.report.send_status, 'sent');
  assert.equal(db.writes.length, writesBefore, 'duplicate must not write a success send record or overwrite report');
  assert.equal(app.logs.at(-1).actionType, 'daily_report.duplicate');
  assert.equal(app.requests.length, 1, 'only the stubbed webhook is called');
});

test('real weekly duplicate send preserves sent status and timestamp', async () => {
  const weekly = { ...report, start_date: '2026-11-23', end_date: '2026-11-29', summary_payload: {} };
  const db = fakeDb({ students: [student], weekly_reports: [weekly] });
  const app = await runtime(db);
  const send = await app.route('app/api/weekly-report-send/route.js');
  const response = await send.POST(post({ action: 'send', reportId: report.id }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.status, 'duplicate');
  assert.equal(data.report.sent_at, report.sent_at);
  assert.equal(db.writes.length, 0);
  assert.equal(app.logs.at(-1).actionType, 'weekly_report.duplicate');
});

test('new accepted send still persists its normal result', async () => {
  const db = fakeDb({ daily_sessions: [session], daily_reports: [{ ...report, send_status: 'draft', sent_at: null }] });
  const app = await runtime(db, { ok: true, status: 'received', requestId: 'new-request' });
  const send = await app.route('app/api/report-send/route.js');
  const data = await (await send.POST(post({ action: 'send', sessionId: session.id }))).json();
  assert.equal(data.ok, true, JSON.stringify(data));
  assert.equal(data.report.send_status, 'ready');
  assert.equal(app.logs.at(-1).actionType, 'daily_report.send');
  assert.equal(db.writes.filter((write) => write.table === 'report_send_logs').length, 1);
});

test('real scheduler rejects unconfirmed old dates and unprepared reports before insertion', async () => {
  const db = fakeDb({ daily_sessions: [session] });
  const app = await runtime(db);
  const schedules = await app.route('app/api/report-schedules/route.js');
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const args = { action: 'create', reportType: 'daily', reportDate: report.report_date, targets: [{ id: session.id, studentName: student.name }], scheduledAt };
  const helpers = await app.route('lib/reportSchedules.js');
  const dateCheck = helpers.getReportDateConfirmation(args.reportDate, scheduledAt);
  if (dateCheck.required) {
    const unconfirmed = await schedules.POST(post(args));
    assert.equal(unconfirmed.status, 409);
    assert.equal((await unconfirmed.json()).code, 'REPORT_DATE_CONFIRMATION_REQUIRED');
  }
  const missing = await schedules.POST(post({ ...args, dateConfirmation: dateCheck.key }));
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).code, 'REPORT_NOT_READY');
  assert.equal(db.writes.length, 0);
  db.tables.daily_reports = [structuredClone(report)];
  const created = await schedules.POST(post({ ...args, periodLabel: '거짓 날짜', dateConfirmation: dateCheck.key }));
  assert.equal(created.status, 200);
  assert.match((await created.json()).row.label, /^2026-11-27/);
  assert.equal(app.requests.length, 0, 'creating a reservation never sends messages');
});

test('real runner and Slack summary separate duplicates, failures and new accepted sends', async () => {
  const schedule = { id: 'schedule-1', report_type: 'daily', status: 'pending', scheduled_at: '2026-11-27T13:10:00Z', targets: ['duplicate', 'accepted', 'failed'].map((id) => ({ id, studentName: `가상 ${id}` })) };
  const db = fakeDb({ report_send_schedules: [schedule] });
  const app = await runtime(db, {}, {
    'app/api/report-send/route.js': { POST: async (req) => {
      const { sessionId } = await req.json();
      if (sessionId === 'duplicate') return Response.json({ ok: true, duplicate: true, report: { send_status: 'sent' } });
      if (sessionId === 'failed') return Response.json({ error: '먼저 데일리 리포트를 생성하세요.' }, { status: 400 });
      return Response.json({ ok: true, report: { send_status: 'ready' } });
    } },
    'app/api/weekly-report-send/route.js': { POST: async () => { throw new Error('not a weekly schedule'); } },
  });
  const runner = await app.route('app/api/cron/report-send/runner.js');
  const result = await runner.runDueReportSchedules({ supabase: db, scheduleId: schedule.id, ignoreSchedule: true });
  assert.equal(result.totalAccepted, 1);
  assert.equal(result.totalDuplicate, 1);
  assert.equal(result.totalFailed, 1);
  assert.equal(db.tables.report_send_schedules[0].result.sent, 0);
  assert.match(app.slack[0].text, /중복 차단\(미발송\) 1/);
  assert.match(app.slack[0].text, /상태: 일부 실패/);
  assert.equal(app.requests.length, 0);
});
