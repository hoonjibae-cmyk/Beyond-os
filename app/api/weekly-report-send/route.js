import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { ensureReportShareLink } from '../../../lib/reportShare';
import { validateKakaoTemplateVariables } from '../../../lib/reportTemplateValidation';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

const WEBHOOK_URL = process.env.WEEKLY_REPORT_SEND_WEBHOOK_URL
  || process.env.REPORT_SEND_WEBHOOK_URL
  || process.env.KAKAO_REPORT_WEBHOOK_URL
  || '';
const WEBHOOK_SECRET = process.env.WEEKLY_REPORT_SEND_WEBHOOK_SECRET
  || process.env.REPORT_SEND_WEBHOOK_SECRET
  || process.env.KAKAO_SEND_WEBHOOK_SECRET
  || '';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function getReportGuardians(student = {}, reportType = 'weekly') {
  const rows = Array.isArray(student.student_guardians) ? student.student_guardians : [];
  const active = rows.filter((item) => item.is_active !== false && normalizePhone(item.phone));
  const targeted = active.filter((item) => reportType === 'weekly' ? item.receive_weekly_report !== false : item.receive_daily_report !== false);
  const usable = targeted.length ? targeted : active;

  if (usable.length) {
    return usable.map((item, index) => ({
      id: item.id,
      name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
      relationship: item.relationship || '',
      phone: item.phone || '',
      phoneDigits: normalizePhone(item.phone),
      isPrimary: Boolean(item.is_primary),
    }));
  }

  const fallback = normalizePhone(student.parent_phone);
  return fallback ? [{
    id: 'legacy-parent-phone',
    name: '대표 보호자',
    relationship: '대표 보호자',
    phone: student.parent_phone,
    phoneDigits: fallback,
    isPrimary: true,
  }] : [];
}

function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}시간 ${mins}분`;
  if (hours) return `${hours}시간`;
  return `${mins}분`;
}

function calculateLivePureStudyMinutes(session = {}, events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { events, studyWindows });
}

function isParentReportIssueVisible(value = '') {
  const raw = String(value || '').trim();
  const label = raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+\d+일$/, '');
  return !['관리주의', '관리필요'].includes(label);
}

function sanitizeParentIssueSummary(value = '') {
  const issues = String(value || '')
    .replace(/외출 확인 필요/g, '외출 관리 필요')
    .replace(/순공시간 확인 필요/g, '순공시간 부족')
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(isParentReportIssueVisible);
  return issues.length ? issues.join(', ') : '특이사항 없음';
}

function buildLiveWeeklySummary(savedSummary = {}, sessions = [], eventsBySession = {}, scheduleConfig = null) {
  if (!Array.isArray(sessions) || !sessions.length) return savedSummary || {};

  const attendanceDays = sessions.filter((session) => Boolean(session.check_in_at)).length;
  const totalStudyMinutes = sessions.reduce((sum, session) => {
    const studyWindows = resolveScheduleForDate(scheduleConfig, session.session_date).studyWindows;
    return sum + calculateLivePureStudyMinutes(session, eventsBySession[session.id] || [], studyWindows);
  }, 0);

  return {
    ...(savedSummary || {}),
    issueSummary: sanitizeParentIssueSummary(savedSummary?.issueSummary || '특이사항 없음'),
    attendanceDays,
    totalStudyMinutes,
    totalStudy: totalStudyMinutes,
    averageStudyMinutes: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    averageStudy: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
  };
}

function getReportLink(report = {}) {
  return report.report_url || report.public_url || report.share_url || '';
}

function createWeeklyTemplateVariables({ student = {}, report = {}, reportLink = '', summaryOverride = null }) {
  const summary = summaryOverride || report.summary_payload || {};
  const variables = {
    studentName: student.name || '',
    period: [report.start_date, report.end_date].filter(Boolean).join(' ~ '),
    weeklyStudyTime: formatMinutesKo(summary.totalStudyMinutes || summary.totalStudy || 0),
    mainCheckSummary: sanitizeParentIssueSummary(summary.issueSummary || '특이사항 없음'),
    reportLink: reportLink || getReportLink(report),
  };

  return {
    ...variables,
    kakaoVariables: {
      '#{학생명}': variables.studentName,
      '#{기간}': variables.period,
      '#{주간순공시간}': variables.weeklyStudyTime,
      '#{확인사항}': variables.mainCheckSummary,
      '#{리포트링크}': variables.reportLink,
    },
    sourceMap: {
      '#{학생명}': 'students.name',
      '#{기간}': 'weekly_reports.start_date ~ weekly_reports.end_date',
      '#{주간순공시간}': 'weekly_reports + daily_sessions 쉬는시간 제외 실시간 주간 순공시간 계산값',
      '#{확인사항}': 'weekly_reports.summary_payload.issueSummary',
      '#{리포트링크}': 'report_url/public_url/share_url',
    },
  };
}

async function safeUpdateWeeklyReport(supabase, reportId, fullPayload, fallbackPayload = {}) {
  const { data, error } = await supabase
    .from('weekly_reports')
    .update(fullPayload)
    .eq('id', reportId)
    .select()
    .single();

  if (!error) return { report: data, warning: null };

  if (Object.keys(fallbackPayload).length) {
    const fallback = await supabase
      .from('weekly_reports')
      .update(fallbackPayload)
      .eq('id', reportId)
      .select()
      .single();

    if (!fallback.error) {
      return {
        report: fallback.data,
        warning: `위클리 발송 상태 컬럼이 아직 없어서 일부 상태 저장을 건너뛰었습니다. v40-25 SQL을 실행하세요. (${error.message})`,
      };
    }
  }

  return {
    report: null,
    warning: `위클리 발송 상태 저장 실패. v40-25 SQL 실행 여부를 확인하세요. (${error.message})`,
  };
}

const WEBHOOK_TIMEOUT_MS = 10000;

function mapWebhookStatusToBeyondStatus(rawStatus, ok) {
  const status = String(rawStatus || '').toLowerCase();

  if (['sent', 'delivered', 'success', 'completed'].includes(status)) return 'sent';
  if (['failed', 'error', 'rejected', 'undelivered'].includes(status)) return 'failed';
  if (['received', 'queued', 'accepted', 'ready', 'pending', 'requested'].includes(status)) return 'ready';

  // 안전장치: Webhook 서버가 정상 응답만 주고 실제 발송완료 여부를 명시하지 않으면 발송대기로 둡니다.
  return ok ? 'ready' : 'failed';
}

function normalizeWebhookResult(response, json, text) {
  const bodyOk = typeof json?.ok === 'boolean' ? json.ok : response.ok;
  const transportOk = Boolean(response.ok && bodyOk !== false);
  const providerStatus = String(json?.status || '').toLowerCase();
  const mappedStatus = mapWebhookStatusToBeyondStatus(providerStatus, transportOk);
  const ok = transportOk && mappedStatus !== 'failed';

  return {
    configured: true,
    ok,
    status: mappedStatus,
    providerStatus: providerStatus || (response.ok ? 'received' : 'failed'),
    provider: json?.provider || 'webhook',
    response: json || text,
    requestId: json?.requestId || json?.request_id || null,
    errorCode: mappedStatus === 'failed' ? (json?.errorCode || json?.error_code || `HTTP_${response.status}`) : null,
    recipientPolicy: json?.recipientPolicy || null,
    recipientResults: Array.isArray(json?.recipientResults) ? json.recipientResults : [],
    recipientStats: json?.recipientStats || null,
    partialSuccess: Boolean(json?.partialSuccess || json?.recipientStats?.partialSuccess),
    message: json?.message || (mappedStatus === 'sent' ? '위클리 리포트 발송 완료' : mappedStatus === 'ready' ? '발송 서버가 요청을 접수했습니다. 실제 발송 완료 전까지 발송대기로 표시합니다.' : '위클리 리포트 발송 실패'),
    httpStatus: response.status,
  };
}

async function callWebhook(payload) {
  if (!WEBHOOK_URL) {
    return {
      configured: false,
      ok: false,
      status: 'ready',
      provider: 'kakao_pending',
      message: '위클리 리포트 발송 버튼이 준비되었습니다. WEEKLY_REPORT_SEND_WEBHOOK_URL 또는 REPORT_SEND_WEBHOOK_URL 연결 후 실제 카카오 발송됩니다.',
      errorCode: 'WEBHOOK_NOT_CONFIGURED',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SECRET ? { 'x-beyond-webhook-secret': WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return normalizeWebhookResult(response, json, text);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      configured: true,
      ok: false,
      status: 'failed',
      provider: 'webhook',
      response: null,
      errorCode: timedOut ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_REQUEST_ERROR',
      message: timedOut
        ? '발송 서버 응답이 10초를 초과해 발송 실패로 기록했습니다.'
        : (error.message || 'Webhook 요청 중 오류가 발생했습니다.'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'weeklyReports');
  if (denied) return denied;

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';
    const action = ['preview', 'send'].includes(String(body.action || '').trim()) ? String(body.action || '').trim() : 'send';

    if (!body.reportId) {
      return Response.json({ error: 'reportId is required' }, { status: 400 });
    }

    const { data: report, error: reportError } = await supabase
      .from('weekly_reports')
      .select('*')
      .eq('id', body.reportId)
      .single();

    if (reportError) throw reportError;

    if (!report?.report_text) {
      return Response.json({ error: '먼저 위클리 리포트를 저장하세요.' }, { status: 400 });
    }

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('id', report.student_id)
      .maybeSingle();

    if (studentError) throw studentError;

    const recipients = getReportGuardians(student || {}, 'weekly');
    const recipientPhone = recipients[0]?.phoneDigits || '';

    let liveWeeklySummary = report.summary_payload || {};
    try {
      const { data: weeklySessions } = await supabase
        .from('daily_sessions')
        .select('*')
        .eq('student_id', report.student_id)
        .gte('session_date', report.start_date)
        .lte('session_date', report.end_date);
      const sessionIds = (weeklySessions || []).map((session) => session.id).filter(Boolean);
      let eventsBySession = {};
      if (sessionIds.length) {
        const { data: eventRows } = await supabase
          .from('attendance_events')
          .select('session_id,event_type,event_at,created_at')
          .in('session_id', sessionIds)
          .order('event_at', { ascending: true });
        for (const event of eventRows || []) {
          if (!eventsBySession[event.session_id]) eventsBySession[event.session_id] = [];
          eventsBySession[event.session_id].push(event);
        }
      }
      liveWeeklySummary = buildLiveWeeklySummary(report.summary_payload || {}, weeklySessions || [], eventsBySession, scheduleConfig);
    } catch {
      liveWeeklySummary = report.summary_payload || {};
    }

    const basePayload = {
      sent_channel: 'kakao',
      parent_phone_snapshot: recipients.map((item) => item.phoneDigits).join(',') || null,
      updated_at: new Date().toISOString(),
    };

    if (!recipientPhone) {
      const update = await safeUpdateWeeklyReport(
        supabase,
        report.id,
        {
          ...basePayload,
          send_status: 'failed',
          send_error: '학부모 연락처가 없습니다.',
          send_payload: {
            reportType: 'weekly',
            studentName: student?.name,
            studentId: student?.id,
            weeklyReportId: report.id,
            startDate: report.start_date,
            endDate: report.end_date,
            recipientCount: recipients.length,
          },
        },
        { updated_at: new Date().toISOString() }
      );

      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.failed',
        targetType: 'weekly_report',
        targetId: report.id,
        targetName: student?.name,
        payload: {
          studentId: student?.id,
          startDate: report.start_date,
          endDate: report.end_date,
          status: 'failed',
          reason: '학부모 연락처가 없습니다.',
        },
      });

      return Response.json({
        error: '학부모 연락처가 없어 발송할 수 없습니다.',
        status: 'failed',
        report: update.report || report,
        warning: update.warning,
      }, { status: 400 });
    }

    const shareLink = await ensureReportShareLink(supabase, request, {
      reportType: 'weekly',
      reportId: report.id,
      createdBy: actorName,
    });

    const sendPayload = {
      channel: 'kakao',
      mode: 'live_webhook',
      isTest: false,
      actualSend: true,
      providerAdapterHint: 'KAKAO_PROVIDER_MODE와 KAKAO_FAIL_SAFE_MODE는 /api/kakao-send-webhook에서 최종 판단합니다.',
      reportType: 'weekly',
      recipientPhone,
      recipientPhones: recipients.map((item) => item.phoneDigits),
      recipients: recipients.map((item) => ({ name: item.name, relationship: item.relationship, phone: item.phoneDigits, isPrimary: item.isPrimary })),
      studentName: student?.name,
      studentId: student?.id,
      weeklyReportId: report.id,
      idempotencyKey: `weekly:${report.id}:${recipients.map((item) => item.phoneDigits).join(',') || 'no-recipient'}`,
      startDate: report.start_date,
      endDate: report.end_date,
      messageText: report.report_text,
      parentPhoneSnapshot: recipients.map((item) => item.phoneDigits).join(','),
      weeklySummarySnapshot: liveWeeklySummary,
      templateVariables: createWeeklyTemplateVariables({ student, report, reportLink: shareLink.url, summaryOverride: liveWeeklySummary }),
      requestedBy: actorName,
    };

    const templateValidation = validateKakaoTemplateVariables(sendPayload, 'weekly');
    sendPayload.templateValidation = templateValidation;

    if (!shareLink.url) {
      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.failed',
        targetType: 'weekly_report',
        targetId: report.id,
        targetName: student?.name,
        payload: {
          status: 'failed',
          reason: '공개 리포트 링크를 생성하지 못했습니다.',
          errorCode: 'PUBLIC_WEEKLY_REPORT_LINK_MISSING',
          shareLinkError: shareLink.error || null,
          studentId: student?.id,
          startDate: report.start_date,
          endDate: report.end_date,
        },
      });

      return Response.json({
        error: '공개 리포트 링크를 생성하지 못해 발송을 중단했습니다. v40-83 SQL 실행 여부와 PUBLIC_APP_URL 설정을 확인하세요.',
        code: 'PUBLIC_WEEKLY_REPORT_LINK_MISSING',
        shareLinkError: shareLink.error || null,
      }, { status: 400 });
    }

    if (!templateValidation.ok) {
      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.failed',
        targetType: 'weekly_report',
        targetId: report.id,
        targetName: student?.name,
        payload: {
          status: 'failed',
          reason: '카카오 템플릿 필수 변수가 누락되었습니다.',
          errorCode: 'KAKAO_TEMPLATE_VARIABLE_INVALID',
          templateValidation,
          studentId: student?.id,
          startDate: report.start_date,
          endDate: report.end_date,
        },
      });

      return Response.json({
        error: `카카오 템플릿 필수 변수가 누락되었습니다: ${templateValidation.missing.join(', ')}`,
        code: 'KAKAO_TEMPLATE_VARIABLE_INVALID',
        templateValidation,
      }, { status: 400 });
    }

    if (action === 'preview') {
      await writeUserActionLog(supabase, request, {
        actionType: 'weekly_report.preview',
        targetType: 'weekly_report',
        targetId: report.id,
        targetName: student?.name,
        payload: {
          studentId: student?.id,
          startDate: report.start_date,
          endDate: report.end_date,
          recipientCount: recipients.length,
          templateValidation,
          shareLinkUrl: shareLink.url || null,
        },
      });

      return Response.json({
        ok: true,
        mode: 'preview',
        sendPayload,
        report,
        shareLink: { url: shareLink.url || null, token: shareLink.token || null },
      });
    }

    const result = await callWebhook(sendPayload);
    const nowIso = new Date().toISOString();
    const sendStatus = result.status;
    const sendError = sendStatus === 'failed' ? (result.message || '발송 실패') : null;

    const update = await safeUpdateWeeklyReport(
      supabase,
      report.id,
      {
        ...basePayload,
        send_status: sendStatus,
        sent_at: sendStatus === 'sent' ? nowIso : null,
        sent_channel: result.provider || 'kakao',
        send_error: sendError,
        send_payload: {
          ...sendPayload,
          provider: result.provider,
          providerStatus: result.providerStatus || null,
          configured: result.configured,
          requestId: result.requestId || null,
          errorCode: result.errorCode || null,
          recipientPolicy: result.recipientPolicy || null,
          recipientResults: result.recipientResults || [],
          recipientStats: result.recipientStats || null,
          partialSuccess: Boolean(result.partialSuccess || result.recipientStats?.partialSuccess),
          response: result.response || null,
        },
      },
      { updated_at: nowIso }
    );

    await writeUserActionLog(supabase, request, {
      actionType: sendStatus === 'failed' ? 'weekly_report.failed' : 'weekly_report.send',
      targetType: 'weekly_report',
      targetId: report.id,
      targetName: student?.name,
      payload: {
        studentId: student?.id,
        startDate: report.start_date,
        endDate: report.end_date,
        status: sendStatus,
        provider: result.provider,
        providerStatus: result.providerStatus || null,
        configured: result.configured,
        requestId: result.requestId || null,
        errorCode: result.errorCode || null,
        recipientPhone,
        recipientPhones: recipients.map((item) => item.phoneDigits),
        recipientCount: recipients.length,
        recipientPolicy: result.recipientPolicy || null,
        recipientResults: result.recipientResults || [],
        recipientStats: result.recipientStats || null,
        partialSuccess: Boolean(result.partialSuccess || result.recipientStats?.partialSuccess),
        errorMessage: sendError,
        idempotencyKey: sendPayload.idempotencyKey,
      },
    });

    return Response.json({
      ok: result.ok,
      configured: result.configured,
      status: sendStatus,
      provider: result.provider,
      providerStatus: result.providerStatus || null,
      requestId: result.requestId || null,
      errorCode: result.errorCode || null,
      message: update.warning ? `${result.message} ${update.warning}` : result.message,
      sendPayload,
      response: result.response,
      report: update.report || report,
      warning: update.warning,
    }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
