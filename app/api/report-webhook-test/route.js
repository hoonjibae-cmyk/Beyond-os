import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

const WEBHOOK_TIMEOUT_MS = 10000;
const WEBHOOK_SECRET = process.env.REPORT_SEND_WEBHOOK_SECRET || process.env.KAKAO_SEND_WEBHOOK_SECRET || '';

function envStatus(reportType) {
  const names = reportType === 'weekly'
    ? ['WEEKLY_REPORT_SEND_WEBHOOK_URL', 'REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL']
    : ['REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL'];

  for (const name of names) {
    if (process.env[name]) return { configured: true, envName: name, url: process.env[name] };
  }
  return { configured: false, envName: names[0], url: '' };
}

function makePayload(reportType, actorName) {
  const isWeekly = reportType === 'weekly';
  return {
    channel: 'kakao',
    mode: 'test_webhook',
    isTest: true,
    actualSend: false,
    reportType: isWeekly ? 'weekly' : 'daily',
    studentName: '테스트 학생',
    studentId: 'test-student-id',
    reportId: isWeekly ? 'test-weekly-report-id' : 'test-daily-report-id',
    idempotencyKey: isWeekly ? 'test:webhook:weekly:test-weekly-report-id:01000000000' : 'test:webhook:daily:test-daily-report-id:01000000000',
    sessionId: isWeekly ? null : 'test-session-id',
    reportDate: isWeekly ? null : new Date().toISOString().slice(0, 10),
    startDate: isWeekly ? '2026-06-29' : null,
    endDate: isWeekly ? '2026-07-05' : null,
    recipients: [
      { name: '모', relationship: '모', phone: '01000000000', isPrimary: true },
      { name: '부', relationship: '부', phone: '01000002222', isPrimary: false },
    ],
    recipientPhones: ['01000000000', '01000002222'],
    messageText: isWeekly
      ? '[비욘드 주간 리포트]\n학생: 테스트 학생\n기간: 2026-06-29 ~ 2026-07-05\n\nWebhook 연결 테스트입니다. 실제 발송하지 마세요.'
      : '[비욘드 데일리 리포트]\n학생: 테스트 학생\n날짜: 2026-06-29\n\nWebhook 연결 테스트입니다. 실제 발송하지 마세요.',
    templateVariables: isWeekly ? {
      studentName: '테스트 학생',
      period: '2026-06-29 ~ 2026-07-05',
      weeklyStudyTime: '18시간 20분',
      mainCheckSummary: '순공부족 1회',
      reportLink: 'https://example.com/weekly-report',
      kakaoVariables: {
        '#{학생명}': '테스트 학생',
        '#{기간}': '2026-06-29 ~ 2026-07-05',
        '#{주간순공시간}': '18시간 20분',
        '#{확인사항}': '순공부족 1회',
        '#{리포트링크}': 'https://example.com/weekly-report',
      },
    } : {
      studentName: '테스트 학생',
      date: '2026-06-29',
      attendanceStatus: '학습중',
      pureStudyTime: '5시간 20분',
      mainCheckSummary: '특이사항 없음',
      reportLink: 'https://example.com/daily-report',
      kakaoVariables: {
        '#{학생명}': '테스트 학생',
        '#{날짜}': '2026-06-29',
        '#{출결상태}': '학습중',
        '#{순공시간}': '5시간 20분',
        '#{확인사항}': '특이사항 없음',
        '#{리포트링크}': 'https://example.com/daily-report',
      },
    },
    plannerImageUrl: isWeekly ? null : 'https://example.com/test-planner-image.jpg',
    hasPlannerImage: !isWeekly,
    requestedBy: actorName,
    requestedAt: new Date().toISOString(),
  };
}

function standardizeWebhookResult({ configured, envName, reportType, response, json, text, error, timedOut }) {
  if (!configured) {
    return {
      ok: false,
      status: 'failed',
      provider: 'webhook',
      message: `${envName}이 설정되지 않았습니다.`,
      errorCode: 'WEBHOOK_NOT_CONFIGURED',
    };
  }

  if (timedOut) {
    return {
      ok: false,
      status: 'failed',
      provider: 'webhook',
      message: 'Webhook 응답 제한시간 10초를 초과했습니다.',
      errorCode: 'WEBHOOK_TIMEOUT',
    };
  }

  if (error) {
    return {
      ok: false,
      status: 'failed',
      provider: 'webhook',
      message: error.message || 'Webhook 요청 중 오류가 발생했습니다.',
      errorCode: 'WEBHOOK_REQUEST_ERROR',
    };
  }

  const responseBody = json || text || null;
  const bodyOk = typeof json?.ok === 'boolean' ? json.ok : response?.ok;
  const ok = Boolean(response?.ok && bodyOk !== false);
  return {
    ok,
    status: ok ? (json?.status || 'received') : (json?.status || 'failed'),
    provider: json?.provider || 'webhook',
    message: json?.message || (ok ? 'Webhook 테스트 요청을 정상 수신했습니다.' : 'Webhook 테스트 요청이 실패했습니다.'),
    requestId: json?.requestId || json?.request_id || null,
    errorCode: ok ? null : (json?.errorCode || json?.error_code || `HTTP_${response?.status || 'ERROR'}`),
    httpStatus: response?.status || null,
    response: responseBody,
    reportType,
  };
}

async function callWebhook(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-beyond-os-test': 'true',
        ...(WEBHOOK_SECRET ? { 'x-beyond-webhook-secret': WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const reportType = body.reportType === 'weekly' ? 'weekly' : 'daily';
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';
    const config = envStatus(reportType);
    const payload = makePayload(reportType, actorName);

    let standardResponse;
    if (!config.configured) {
      standardResponse = standardizeWebhookResult({ configured: false, envName: config.envName, reportType });
    } else {
      try {
        const result = await callWebhook(config.url, payload);
        standardResponse = standardizeWebhookResult({
          configured: true,
          envName: config.envName,
          reportType,
          ...result,
        });
      } catch (error) {
        standardResponse = standardizeWebhookResult({
          configured: true,
          envName: config.envName,
          reportType,
          error,
          timedOut: error?.name === 'AbortError',
        });
      }
    }

    const supabase = getSupabaseAdmin();
    await writeUserActionLog(supabase, request, {
      actionType: reportType === 'weekly' ? 'weekly_report.webhook_test' : 'daily_report.webhook_test',
      targetType: 'report_webhook_test',
      targetId: reportType,
      targetName: reportType === 'weekly' ? '위클리 Webhook 연결 테스트' : '데일리 Webhook 연결 테스트',
      payload: {
        reportType,
        configured: config.configured,
        envName: config.envName,
        status: standardResponse.status,
        ok: standardResponse.ok,
        message: standardResponse.message,
        errorCode: standardResponse.errorCode,
        requestId: standardResponse.requestId,
        testPayload: payload,
      },
    });

    return Response.json({
      ok: standardResponse.ok,
      configured: config.configured,
      envName: config.envName,
      reportType,
      status: standardResponse.status,
      message: standardResponse.message,
      statusMappingHint: '실제 발송에서는 sent만 발송완료, received/queued/accepted는 발송대기로 처리됩니다.',
      payload,
      standardResponse,
    }, { status: 200 });
  } catch (error) {
    return Response.json({
      ok: false,
      status: 'failed',
      error: error.message || 'Webhook 연결 테스트 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
