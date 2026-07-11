import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { cleanupOldUserActionLogs } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

const DAILY_ACTIONS = [
  'daily_report.preview',
  'daily_report.prepare',
  'daily_report.send',
  'daily_report.manual_sent',
  'daily_report.failed',
  'daily_report.webhook_test',
];

const WEEKLY_ACTIONS = [
  'weekly_report.save',
  'weekly_report.preview',
  'weekly_report.send',
  'weekly_report.failed',
  'weekly_report.webhook_test',
];

const KAKAO_DELIVERY_ACTIONS = [
  'kakao_webhook.received',
  'kakao_webhook.forwarded',
  'kakao_webhook.failed',
  'kakao_webhook.recipient_override',
  'kakao_webhook.recipient_blocked',
  'kakao_webhook.duplicate',
  'kakao_webhook.retry_after_safe_request',
];

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function matchesDailyDate(log, date) {
  if (!date) return true;
  const payload = log.payload || {};
  return String(payload.reportDate || log.created_at || '').slice(0, 10) === date
    || String(log.created_at || '').slice(0, 10) === date;
}

function matchesWeeklyRange(log, start, end) {
  if (!start || !end) return true;
  const payload = log.payload || {};
  const logStart = toDate(payload.startDate);
  const logEnd = toDate(payload.endDate);

  if (logStart && logEnd) return logStart <= end && logEnd >= start;

  const created = String(log.created_at || '').slice(0, 10);
  return created >= start && created <= end;
}


function matchesReportType(log, type) {
  const actionType = String(log.action_type || '');
  if (!actionType.startsWith('kakao_webhook.')) return true;
  const payloadType = String(log.payload?.reportType || '').toLowerCase();
  return payloadType ? payloadType === type : true;
}

function hasRecipientFailure(log = {}) {
  const payload = log.payload || {};
  const rows = Array.isArray(payload.recipientResults) ? payload.recipientResults : [];
  if (rows.some((row) => row.status === 'failed')) return true;
  if (payload.partialSuccess) return true;
  return String(payload.status || '').toLowerCase() === 'failed' || String(log.action_type || '').includes('failed');
}

function hasPartialSuccess(log = {}) {
  const payload = log.payload || {};
  if (payload.partialSuccess || payload.recipientStats?.partialSuccess) return true;
  const rows = Array.isArray(payload.recipientResults) ? payload.recipientResults : [];
  const failed = rows.filter((row) => row.status === 'failed').length;
  const success = rows.filter((row) => ['sent', 'received'].includes(row.status)).length;
  return failed > 0 && success > 0;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    await cleanupOldUserActionLogs(supabase);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'weekly' ? 'weekly' : 'daily';
    const date = toDate(searchParams.get('date'));
    const start = toDate(searchParams.get('start'));
    const end = toDate(searchParams.get('end'));
    const actions = type === 'weekly'
      ? [...WEEKLY_ACTIONS, ...KAKAO_DELIVERY_ACTIONS]
      : [...DAILY_ACTIONS, ...KAKAO_DELIVERY_ACTIONS];

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('user_action_logs')
      .select('*')
      .in('action_type', actions)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) throw error;

    const logs = (data || []).filter((log) => {
      if (!matchesReportType(log, type)) return false;
      return type === 'weekly' ? matchesWeeklyRange(log, start, end) : matchesDailyDate(log, date);
    });

    return Response.json({
      type,
      date,
      start,
      end,
      retentionHours: 48,
      logs,
      summary: {
        total: logs.length,
        sent: logs.filter((log) => ['daily_report.send', 'weekly_report.send', 'daily_report.manual_sent'].includes(log.action_type)).length,
        failed: logs.filter(hasRecipientFailure).length,
        partial: logs.filter(hasPartialSuccess).length,
        ready: logs.filter((log) => ['daily_report.prepare'].includes(log.action_type) || ['received', 'queued', 'accepted', 'ready'].includes(String(log.payload?.status || '').toLowerCase())).length,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || '리포트 발송 이력을 불러오지 못했습니다.' }, { status: 500 });
  }
}
