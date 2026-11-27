// A handled duplicate is a new attempt with no new delivery. Keep it separate
// from the original report's delivery status (which may already be sent).
export const DUPLICATE_REPORT_MESSAGE = '중복 차단: 이미 접수된 리포트이므로 이번 요청은 발송하지 않았습니다.';

export function isDuplicateReportAttempt(value = {}) {
  value = value || {};
  const candidates = [value, value.payload, value.providerResult, value.response, value.providerResult?.response].filter(Boolean);
  return String(value.action_type || '').endsWith('.duplicate') || candidates.some((item) => (
    item.duplicate === true || item.status === 'duplicate'
    // Legacy scheduled results retained only the webhook's exact message.
    || String(item.message || '').includes('동일 idempotencyKey 요청이 이미 실제 제공자에 접수되어 중복 발송하지 않았습니다.')
  ));
}

export function getReportAttemptStatus(data = {}) {
  if (isDuplicateReportAttempt(data)) return 'duplicate';
  if (data.skipped || data.status === 'skipped') return 'skipped';
  if (data.ok === false) return 'failed';
  const status = String(data.status || data.report?.send_status || data.providerResult?.status || '').toLowerCase();
  if (['failed', 'error', 'rejected'].includes(status)) return 'failed';
  if (['sent', 'delivered', 'success', 'completed'].includes(status)) return 'sent';
  return 'ready';
}

export function summarizeReportSchedule(result = {}) {
  if (!Array.isArray(result.details) || !result.details.length) {
    const sent = Number(result.sent || 0);
    const ready = Number(result.ready || 0);
    return { ...result, sent, ready, accepted: sent + ready, failed: Number(result.failed || 0), duplicate: Number(result.duplicate || 0), skipped: Number(result.skipped || 0), total: Number(result.total || 0), details: result.details || [] };
  }
  const summary = { sent: 0, ready: 0, accepted: 0, failed: 0, duplicate: 0, skipped: 0, total: result.details.length, details: [] };
  for (const item of result.details) {
    const status = getReportAttemptStatus(item);
    summary[status] += 1;
    summary.details.push({ ...item, status, duplicate: status === 'duplicate' });
  }
  summary.accepted = summary.sent + summary.ready;
  return summary;
}

export function getScheduleOutcome(schedule = {}) {
  const summary = summarizeReportSchedule(schedule.result || schedule);
  if (!['done', 'failed'].includes(schedule.status)) return { summary, label: '', tone: schedule.status };
  if (summary.failed) return { summary, label: summary.failed === summary.total ? '발송 실패' : '일부 실패', tone: 'failed' };
  if (summary.duplicate) return { summary, label: summary.duplicate === summary.total ? '중복 차단 · 미발송' : '처리 완료 · 중복 차단 포함', tone: 'duplicate' };
  if (summary.skipped) return { summary, label: '처리 완료 · 제외 포함', tone: 'duplicate' };
  return { summary, label: summary.ready ? '발송 요청 접수' : summary.sent ? '발송 완료' : '처리 완료', tone: 'done' };
}

// Old daily/weekly main logs omitted duplicate=true. Correlate only an exact
// request/key match immediately following the duplicate webhook diagnostic.
export function normalizeReportActivityLogs(logs = []) {
  const duplicates = logs.filter((log) => log.action_type === 'kakao_webhook.duplicate');
  return logs.map((log) => {
    if (!['daily_report.send', 'weekly_report.send'].includes(log.action_type)) return log;
    const payload = log.payload || {};
    const matched = duplicates.some((duplicate) => {
      const previous = duplicate.payload || {};
      const gap = new Date(log.created_at).getTime() - new Date(duplicate.created_at).getTime();
      return payload.idempotencyKey && payload.requestId && gap >= 0 && gap <= 30000
        && payload.idempotencyKey === previous.idempotencyKey && payload.requestId === previous.previousLogId;
    });
    return matched ? { ...log, payload: { ...payload, status: 'duplicate', duplicate: true, message: DUPLICATE_REPORT_MESSAGE } } : log;
  });
}
