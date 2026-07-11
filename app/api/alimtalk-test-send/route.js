import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getReportSendSettings, resolveRecipientTestMode } from '../../../lib/reportSendSettings';

export const dynamic = 'force-dynamic';

function normalizeReportType(value = 'daily') {
  if (value === 'weekly') return 'weekly';
  if (value === 'attendance') return 'attendance';
  if (value === 'parent_confirmation') return 'parent_confirmation';
  return 'daily';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function parsePhoneList(raw = '') {
  return String(raw || '')
    .split(/[,,\n\s]+/)
    .map((item) => normalizePhone(item))
    .filter(Boolean);
}

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

function getTemplateEnvName(reportType) {
  if (reportType === 'weekly') return process.env.SOLAPI_TEMPLATE_ID_WEEKLY ? 'SOLAPI_TEMPLATE_ID_WEEKLY' : process.env.KAKAO_TEMPLATE_CODE_WEEKLY ? 'KAKAO_TEMPLATE_CODE_WEEKLY' : 'SOLAPI_TEMPLATE_ID_WEEKLY';
  if (reportType === 'attendance') return process.env.SOLAPI_TEMPLATE_ID_ATTENDANCE ? 'SOLAPI_TEMPLATE_ID_ATTENDANCE' : process.env.KAKAO_TEMPLATE_CODE_ATTENDANCE ? 'KAKAO_TEMPLATE_CODE_ATTENDANCE' : 'SOLAPI_TEMPLATE_ID_ATTENDANCE';
  if (reportType === 'parent_confirmation') return process.env.SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION ? 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION' : process.env.KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION ? 'KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION' : 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION';
  return process.env.SOLAPI_TEMPLATE_ID_DAILY ? 'SOLAPI_TEMPLATE_ID_DAILY' : process.env.KAKAO_TEMPLATE_CODE_DAILY ? 'KAKAO_TEMPLATE_CODE_DAILY' : 'SOLAPI_TEMPLATE_ID_DAILY';
}

function isTemplateConfigured(reportType) {
  if (reportType === 'weekly') return Boolean(process.env.SOLAPI_TEMPLATE_ID_WEEKLY || process.env.KAKAO_TEMPLATE_CODE_WEEKLY);
  if (reportType === 'attendance') return Boolean(process.env.SOLAPI_TEMPLATE_ID_ATTENDANCE || process.env.SOLAPI_TEMPLATE_ID_CHECKINOUT || process.env.KAKAO_TEMPLATE_CODE_ATTENDANCE || process.env.KAKAO_TEMPLATE_CODE_CHECKINOUT);
  if (reportType === 'parent_confirmation') return Boolean(process.env.SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION || process.env.KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION);
  return Boolean(process.env.SOLAPI_TEMPLATE_ID_DAILY || process.env.KAKAO_TEMPLATE_CODE_DAILY);
}

function makeRecipients(phones = []) {
  return phones.map((phone, index) => ({
    name: `테스트 수신자 ${index + 1}`,
    relationship: '테스트',
    phone,
    isPrimary: index === 0,
  }));
}

function makePayload(reportType, actorName, recipientPhones) {
  const type = normalizeReportType(reportType);
  const now = Date.now();
  const recipients = makeRecipients(recipientPhones);
  const base = {
    channel: 'kakao',
    mode: 'template_console_test_send',
    actualSend: true,
    isTest: false,
    reportType: type,
    studentName: '테스트 학생',
    studentId: 'test-student-id',
    recipientPhones,
    recipients,
    requestedBy: actorName,
    requestedAt: new Date().toISOString(),
    templateConsoleTest: true,
    forceTestRecipientOnly: true,
  };

  if (type === 'attendance') {
    return {
      ...base,
      attendanceEventId: `test-attendance-event-${now}`,
      reportId: `test-attendance-event-${now}`,
      idempotencyKey: `template-test:attendance:${now}:${recipientPhones.join('-')}`,
      reportDate: new Date().toISOString().slice(0, 10),
      attendanceEventType: '입실',
      attendanceTime: '09:04',
      attendanceSource: '키오스크 자동기록',
      messageText: '[The Place 26 입실 알림]\n\n테스트 학생 학생의 출결 상태가 기록되었습니다.\n\n- 구분: 입실\n- 기준시간: 09:04\n- 기록방식: 키오스크 자동기록\n\n목동유쌤영어학원',
      templateVariables: {
        studentName: '테스트 학생',
        date: new Date().toISOString().slice(0, 10),
        attendanceEventType: '입실',
        attendanceTime: '09:04',
        attendanceSource: '키오스크 자동기록',
        kakaoVariables: {
          '#{학생명}': '테스트 학생',
          '#{날짜}': new Date().toISOString().slice(0, 10),
          '#{출결구분}': '입실',
          '#{출결시간}': '09:04',
          '#{기록방식}': '키오스크 자동기록',
        },
      },
    };
  }

  if (type === 'parent_confirmation') {
    return {
      ...base,
      reportId: `test-parent-confirmation-${now}`,
      idempotencyKey: `template-test:parent_confirmation:${now}:${recipientPhones.join('-')}`,
      plannedStudyTime: '09:00 ~ 22:00',
      plannedBreakTime: '13:00 ~ 15:00 (수학학원)',
      currentStatusText: '외출 후 미복귀',
      messageText: '[The Place 26 학부모 확인 요청]\n\n테스트 학생 학생의 비욘드 썸머스쿨 출결 확인이 필요한 상황이 발생했습니다.\n\n- 금일 예정 학습 시간: 09:00 ~ 22:00\n- 금일 예정 외출 시간: 13:00 ~ 15:00 (수학학원)\n- 현재 상태: 외출 후 미복귀\n\n담당자가 학생 확인을 진행한 뒤, 필요 시 학부모님께 추가 연락드리겠습니다.\n\n목동유쌤영어학원',
      templateVariables: {
        studentName: '테스트 학생',
        plannedStudyTime: '09:00 ~ 22:00',
        plannedBreakTime: '13:00 ~ 15:00 (수학학원)',
        currentStatusText: '외출 후 미복귀',
        kakaoVariables: {
          '#{학생명}': '테스트 학생',
          '#{예정학습시간}': '09:00 ~ 22:00',
          '#{예정외출시간}': '13:00 ~ 15:00 (수학학원)',
          '#{현재상태}': '외출 후 미복귀',
        },
      },
    };
  }

  const isWeekly = type === 'weekly';
  return {
    ...base,
    reportId: isWeekly ? `test-weekly-report-${now}` : `test-daily-report-${now}`,
    idempotencyKey: `template-test:${type}:${now}:${recipientPhones.join('-')}`,
    sessionId: isWeekly ? null : `test-session-${now}`,
    reportDate: isWeekly ? null : new Date().toISOString().slice(0, 10),
    startDate: isWeekly ? '2026-06-29' : null,
    endDate: isWeekly ? '2026-07-05' : null,
    messageText: isWeekly
      ? '테스트 학생 학생의 주간 학습 리포트가 등록되었습니다.\n\n- 기간: 2026-06-29 ~ 2026-07-05\n- 주간 순공시간: 18시간 20분\n- 주요 확인사항: 순공부족 1회\n\n자세한 내용은 아래 링크에서 확인해 주세요.\nhttps://example.com/weekly-report\n\n목동유쌤영어학원'
      : '테스트 학생 학생의 2026-06-29 학습 리포트가 등록되었습니다.\n\n- 출결 상태: 학습중\n- 순공시간: 5시간 20분\n- 주요 확인사항: 특이사항 없음\n\n자세한 내용은 아래 링크에서 확인해 주세요.\nhttps://example.com/daily-report\n\n목동유쌤영어학원',
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
  };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const reportType = normalizeReportType(body.reportType || 'daily');
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';
    const supabase = getSupabaseAdmin();
    const settingsResult = await getReportSendSettings(supabase);
    const settings = settingsResult.settings;
    const envTestMode = boolEnv('KAKAO_RECIPIENT_TEST_MODE', false);
    const dashboardTestMode = resolveRecipientTestMode(settings, envTestMode);
    const testRecipients = parsePhoneList(process.env.KAKAO_TEST_RECIPIENT_PHONES || process.env.KAKAO_TEST_RECIPIENT_PHONE || '');
    const templateConfigured = isTemplateConfigured(reportType);

    if (!testRecipients.length) {
      return Response.json({
        ok: false,
        status: 'failed',
        errorCode: 'TEST_RECIPIENT_MISSING',
        message: '테스트 발송을 위해 KAKAO_TEST_RECIPIENT_PHONE 또는 KAKAO_TEST_RECIPIENT_PHONES가 필요합니다.',
      }, { status: 400 });
    }

    if (!templateConfigured) {
      return Response.json({
        ok: false,
        status: 'failed',
        errorCode: 'TEMPLATE_ID_MISSING',
        reportType,
        envName: getTemplateEnvName(reportType),
        message: `${getTemplateEnvName(reportType)} 환경변수 또는 Direct Kakao 템플릿 코드가 설정되어 있지 않습니다.`,
      }, { status: 400 });
    }

    const payload = makePayload(reportType, actorName, testRecipients);
    const origin = new URL(request.url).origin;
    const webhookSecret = process.env.KAKAO_SEND_WEBHOOK_SECRET || process.env.REPORT_SEND_WEBHOOK_SECRET || '';
    const response = await fetch(`${origin}/api/kakao-send-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookSecret ? { 'x-beyond-webhook-secret': webhookSecret } : {}),
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));

    await writeUserActionLog(supabase, request, {
      actionType: 'alimtalk_template.test_send',
      targetType: 'alimtalk_template',
      targetId: reportType,
      targetName: `${reportType} 테스트 발송`,
      payload: {
        reportType,
        templateEnvName: getTemplateEnvName(reportType),
        templateConfigured,
        testRecipientCount: testRecipients.length,
        dashboardTestMode,
        providerStatus: result.status || null,
        providerMode: result.providerMode || null,
        failSafe: result.failSafe ?? null,
        actualSent: result.actualSent ?? null,
        message: result.message || null,
        errorCode: result.errorCode || null,
      },
    });

    return Response.json({
      ok: response.ok && result.ok !== false,
      reportType,
      templateEnvName: getTemplateEnvName(reportType),
      testRecipientCount: testRecipients.length,
      dashboardTestMode,
      forcedTestRecipientOnly: true,
      status: result.status || (response.ok ? 'received' : 'failed'),
      actualSent: Boolean(result.actualSent),
      failSafe: Boolean(result.failSafe),
      providerMode: result.providerMode || null,
      provider: result.provider || null,
      message: result.message || (response.ok ? '테스트 발송 요청을 처리했습니다.' : '테스트 발송 요청 실패'),
      errorCode: result.errorCode || null,
      recipientStats: result.recipientStats || null,
      recipientResults: result.recipientResults || [],
      webhookResult: result,
    }, { status: response.ok ? 200 : response.status });
  } catch (error) {
    return Response.json({
      ok: false,
      status: 'failed',
      errorCode: 'ALIMTALK_TEST_SEND_ERROR',
      message: error.message || '알림톡 테스트 발송 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
