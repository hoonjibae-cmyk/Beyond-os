import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getSolapiAdapterStatus, sendSolapiAlimtalk } from '../../../lib/solapiAdapter';
import { getReportSendSettings, getRecipientTestModeSource, resolveRecipientTestMode } from '../../../lib/reportSendSettings';
import { getNoticeCategory } from '../../../lib/noticeTemplates';

export const dynamic = 'force-dynamic';

const PROVIDER_URL = process.env.KAKAO_PROVIDER_WEBHOOK_URL
  || process.env.KAKAO_ALIMTALK_WEBHOOK_URL
  || '';
const WEBHOOK_SECRET = process.env.KAKAO_SEND_WEBHOOK_SECRET
  || process.env.REPORT_SEND_WEBHOOK_SECRET
  || '';
const PROVIDER_SECRET = process.env.KAKAO_PROVIDER_WEBHOOK_SECRET || '';
const PROVIDER_TIMEOUT_MS = 10000;
const RECIPIENT_TEST_MODE = boolEnv('KAKAO_RECIPIENT_TEST_MODE', false);
const TEST_RECIPIENTS_RAW = process.env.KAKAO_TEST_RECIPIENT_PHONES || process.env.KAKAO_TEST_RECIPIENT_PHONE || '';
const RECIPIENT_ALLOWLIST_RAW = process.env.KAKAO_RECIPIENT_ALLOWLIST || '';
const DIRECT_API_URL = process.env.KAKAO_DIRECT_API_URL || '';
const DIRECT_API_KEY = process.env.KAKAO_DIRECT_API_KEY || '';
const SENDER_KEY = process.env.KAKAO_SENDER_KEY || '';
const TEMPLATE_CODE_DAILY = process.env.KAKAO_TEMPLATE_CODE_DAILY || '';
const TEMPLATE_CODE_WEEKLY = process.env.KAKAO_TEMPLATE_CODE_WEEKLY || '';
const TEMPLATE_CODE_ATTENDANCE = process.env.KAKAO_TEMPLATE_CODE_ATTENDANCE || process.env.KAKAO_TEMPLATE_CODE_CHECKINOUT || '';
const TEMPLATE_CODE_PARENT_CONFIRMATION = process.env.KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION || '';
const TEMPLATE_CODE_NOTICE = process.env.KAKAO_TEMPLATE_CODE_NOTICE || '';

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

function normalizeProviderMode() {
  const raw = String(process.env.KAKAO_PROVIDER_MODE || '').trim().toLowerCase();
  if (['mock', 'webhook', 'kakao', 'kakao_ready', 'solapi'].includes(raw)) return raw;
  return PROVIDER_URL ? 'webhook' : 'mock';
}

const PROVIDER_MODE = normalizeProviderMode();
const FAIL_SAFE_MODE = boolEnv('KAKAO_FAIL_SAFE_MODE', true);

function getProviderAdapterStatus(reportType = 'daily', reportSendSettings = null, noticeCategory) {
  const templateCode = getTemplateCode(reportType, noticeCategory);
  const directConfigured = Boolean(DIRECT_API_URL && DIRECT_API_KEY && SENDER_KEY && templateCode);
  const webhookConfigured = Boolean(PROVIDER_URL);
  const solapi = getSolapiAdapterStatus(reportType, noticeCategory);

  return {
    providerMode: PROVIDER_MODE,
    failSafe: FAIL_SAFE_MODE,
    providerConfigured: webhookConfigured,
    directConfigured,
    directApiConfigured: Boolean(DIRECT_API_URL),
    directApiKeyConfigured: Boolean(DIRECT_API_KEY),
    senderKeyConfigured: Boolean(SENDER_KEY),
    templateConfigured: Boolean(templateCode),
    solapiConfigured: solapi.configured,
    solapiApiKeyConfigured: solapi.apiKeyConfigured,
    solapiApiSecretConfigured: solapi.apiSecretConfigured,
    solapiChannelConfigured: solapi.channelConfigured,
    solapiTemplateConfigured: solapi.templateConfigured,
    actualSendEnabled: !FAIL_SAFE_MODE && (
      (PROVIDER_MODE === 'webhook' && webhookConfigured)
      || (PROVIDER_MODE === 'kakao' && directConfigured)
      || (PROVIDER_MODE === 'solapi' && solapi.configured)
    ),
    recipientTestMode: getRecipientPolicyStatus(reportSendSettings).testMode,
    recipientAllowlistConfigured: getRecipientPolicyStatus(reportSendSettings).allowlistConfigured,
  };
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

function normalizePhoneList(payload = {}) {
  if (Array.isArray(payload.recipientPhones)) return payload.recipientPhones.map(normalizePhone).filter(Boolean);
  if (payload.recipientPhone) return [normalizePhone(payload.recipientPhone)].filter(Boolean);
  if (Array.isArray(payload.recipients)) return payload.recipients.map((item) => normalizePhone(item.phone)).filter(Boolean);
  if (Array.isArray(payload.to)) return payload.to.map(normalizePhone).filter(Boolean);
  return [];
}

function getRecipientPolicyStatus(reportSendSettings = null) {
  const testRecipients = parsePhoneList(TEST_RECIPIENTS_RAW);
  const allowlist = parsePhoneList(RECIPIENT_ALLOWLIST_RAW);
  const testMode = resolveRecipientTestMode(reportSendSettings || {}, RECIPIENT_TEST_MODE);
  return {
    testMode,
    envTestMode: RECIPIENT_TEST_MODE,
    testModeSource: getRecipientTestModeSource(reportSendSettings || {}),
    testRecipients,
    allowlist,
    testRecipientConfigured: testRecipients.length > 0,
    allowlistConfigured: allowlist.length > 0,
  };
}

function applyRecipientPolicy(payload = {}, reportSendSettings = null) {
  const policy = getRecipientPolicyStatus(reportSendSettings);
  const originalPhones = normalizePhoneList(payload);

  if (payload.isTest || payload.actualSend === false) {
    return {
      ok: true,
      payload,
      policy: {
        ...policy,
        mode: 'test_payload',
        originalPhones,
        finalPhones: originalPhones,
      },
    };
  }

  if (policy.testMode) {
    if (!policy.testRecipients.length) {
      return {
        ok: false,
        errorCode: 'KAKAO_TEST_RECIPIENT_MISSING',
        message: 'KAKAO_RECIPIENT_TEST_MODE=true 상태이지만 KAKAO_TEST_RECIPIENT_PHONE이 설정되지 않았습니다.',
        policy: { ...policy, mode: 'test_mode_missing_recipient', originalPhones, finalPhones: [] },
      };
    }

    const recipients = policy.testRecipients.map((phone, index) => ({
      name: `테스트 수신자 ${index + 1}`,
      relationship: '테스트',
      phone,
      isPrimary: index === 0,
    }));

    return {
      ok: true,
      payload: {
        ...payload,
        recipientPhone: policy.testRecipients[0],
        recipientPhones: policy.testRecipients,
        to: policy.testRecipients,
        recipients,
        originalRecipientPhones: originalPhones,
        recipientPolicy: {
          mode: 'test_recipient_override',
          originalRecipientPhones: originalPhones,
          finalRecipientPhones: policy.testRecipients,
        },
      },
      policy: {
        ...policy,
        mode: 'test_recipient_override',
        originalPhones,
        finalPhones: policy.testRecipients,
      },
    };
  }

  if (policy.allowlist.length) {
    const blocked = originalPhones.filter((phone) => !policy.allowlist.includes(phone));
    if (blocked.length) {
      return {
        ok: false,
        errorCode: 'KAKAO_RECIPIENT_NOT_ALLOWLISTED',
        message: `Allowlist에 없는 수신번호가 포함되어 실제 발송을 차단했습니다: ${blocked.join(', ')}`,
        policy: { ...policy, mode: 'allowlist_blocked', originalPhones, finalPhones: originalPhones, blockedPhones: blocked },
      };
    }
  }

  return {
    ok: true,
    payload: {
      ...payload,
      recipientPolicy: {
        mode: policy.allowlist.length ? 'allowlist_allowed' : 'unrestricted',
        originalRecipientPhones: originalPhones,
        finalRecipientPhones: originalPhones,
      },
    },
    policy: {
      ...policy,
      mode: policy.allowlist.length ? 'allowlist_allowed' : 'unrestricted',
      originalPhones,
      finalPhones: originalPhones,
    },
  };
}

function makeIdempotencyKey(payload = {}) {
  if (payload.idempotencyKey) return String(payload.idempotencyKey);
  const reportType = payload.reportType || 'report';
  const reportId = payload.reportId || payload.weeklyReportId || payload.attendanceEventId || payload.sessionId || 'unknown';
  const phones = normalizePhoneList(payload).join(',');
  return `${reportType}:${reportId}:${phones || 'no-recipient'}`;
}


function getRecipientDisplayRows(payload = {}, phoneList = []) {
  const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
  return (phoneList || []).map((phone, index) => {
    const matched = recipients.find((item) => normalizePhone(item?.phone) === phone) || recipients[index] || {};
    return {
      name: matched.name || matched.relationship || `수신자 ${index + 1}`,
      relationship: matched.relationship || '',
      phone,
      isPrimary: Boolean(matched.isPrimary || index === 0),
    };
  });
}

function buildRecipientDeliverySnapshot(originalPayload = {}, providerResult = {}, finalRecipientPolicy = null) {
  if (Array.isArray(providerResult.recipientResults) && providerResult.recipientResults.length) {
    const rows = providerResult.recipientResults.map((item) => ({
      name: item.name || item.relationship || '수신자',
      relationship: item.relationship || '',
      phone: normalizePhone(item.phone),
      status: item.status || providerResult.status || 'received',
      providerStatus: item.providerStatus || providerResult.providerStatus || providerResult.status || null,
      messageId: item.messageId || null,
      errorMessage: item.errorMessage || null,
    })).filter((item) => item.phone);
    return { rows, stats: summarizeRecipientDeliveryRows(rows) };
  }

  const finalPhones = finalRecipientPolicy?.finalPhones
    || finalRecipientPolicy?.finalRecipientPhones
    || normalizePhoneList(originalPayload);
  const rows = getRecipientDisplayRows(originalPayload, finalPhones).map((item) => ({
    ...item,
    status: providerResult.status === 'failed' ? 'failed' : providerResult.status === 'sent' ? 'sent' : 'received',
    providerStatus: providerResult.providerStatus || providerResult.status || null,
    messageId: null,
    errorMessage: providerResult.status === 'failed' ? (providerResult.message || providerResult.errorCode || null) : null,
  }));
  return { rows, stats: summarizeRecipientDeliveryRows(rows) };
}

function summarizeRecipientDeliveryRows(rows = []) {
  const total = rows.length;
  const failed = rows.filter((item) => item.status === 'failed').length;
  const sent = rows.filter((item) => item.status === 'sent').length;
  const received = rows.filter((item) => item.status === 'received').length;
  return {
    total,
    sent,
    received,
    failed,
    successLike: sent + received,
    partialSuccess: failed > 0 && sent + received > 0,
  };
}

async function findExistingRequest(supabase, idempotencyKey) {
  try {
    const { data } = await supabase
      .from('user_action_logs')
      .select('*')
      .contains('payload', { idempotencyKey })
      .in('action_type', ['kakao_webhook.forwarded', 'kakao_webhook.duplicate'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data || null;
  } catch {
    return null;
  }
}


function shouldBlockDuplicateRequest(existing) {
  const previous = existing?.payload || {};
  const status = String(previous.status || '').toLowerCase();
  const providerMode = String(previous.providerMode || '').toLowerCase();

  if (!existing) return false;
  if (status === 'failed') return false;
  if (previous.failSafe === true) return false;
  if (['mock', 'kakao_ready'].includes(providerMode)) return false;

  // 실제 제공자(webhook/kakao/solapi)가 received/sent로 응답한 요청은
  // 발송 완료 또는 제공자 접수 상태일 수 있으므로 재발송을 차단합니다.
  return true;
}

function getTemplateCode(reportType, noticeCategory) {
  if (reportType === 'weekly') return TEMPLATE_CODE_WEEKLY;
  if (reportType === 'attendance') return TEMPLATE_CODE_ATTENDANCE;
  if (reportType === 'parent_confirmation') return TEMPLATE_CODE_PARENT_CONFIRMATION;
  if (reportType === 'notice') {
    const cat = getNoticeCategory(noticeCategory);
    for (const name of cat.templateCodeEnvs || []) {
      if (process.env[name]) return process.env[name];
    }
    return TEMPLATE_CODE_NOTICE;
  }
  return TEMPLATE_CODE_DAILY;
}

function buildDirectKakaoPayload(payload = {}) {
  return {
    mode: 'kakao_direct',
    isTest: Boolean(payload.isTest),
    actualSend: Boolean(payload.actualSend),
    senderKey: SENDER_KEY,
    templateCode: getTemplateCode(payload.reportType, payload.noticeCategory),
    reportType: payload.reportType,
    idempotencyKey: payload.idempotencyKey,
    to: payload.recipientPhones || (payload.recipientPhone ? [payload.recipientPhone] : []),
    recipients: payload.recipients || [],
    studentName: payload.studentName,
    messageText: payload.messageText,
    plannerImageUrl: payload.plannerImageUrl || null,
    templateVariables: payload.templateVariables || {},
    templateValidation: payload.templateValidation || null,
    requestedBy: payload.requestedBy,
    requestedAt: payload.requestedAt || new Date().toISOString(),
    metadata: {
      studentId: payload.studentId,
      reportId: payload.reportId || payload.weeklyReportId || payload.attendanceEventId,
      sessionId: payload.sessionId,
      reportDate: payload.reportDate,
      startDate: payload.startDate,
      endDate: payload.endDate,
      attendanceEventId: payload.attendanceEventId || null,
      notificationType: payload.notificationType || null,
    },
  };
}

async function callDirectKakaoProvider(payload, adapter) {
  const templateCode = getTemplateCode(payload.reportType, payload.noticeCategory);

  if (!DIRECT_API_URL || !DIRECT_API_KEY || !SENDER_KEY || !templateCode) {
    return {
      ok: false,
      status: 'failed',
      provider: 'kakao_direct',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: 'Direct Kakao API 설정이 부족합니다. KAKAO_DIRECT_API_URL / KAKAO_DIRECT_API_KEY / KAKAO_SENDER_KEY / 템플릿 코드를 확인하세요.',
      errorCode: 'KAKAO_DIRECT_CONFIG_MISSING',
      actualSent: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const directPayload = buildDirectKakaoPayload(payload);
    const response = await fetch(DIRECT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DIRECT_API_KEY}`,
        'x-api-key': DIRECT_API_KEY,
      },
      body: JSON.stringify(directPayload),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const providerStatus = String(json?.status || '').toLowerCase();
    const sent = ['sent', 'delivered', 'success', 'completed'].includes(providerStatus);
    const failed = !response.ok || json?.ok === false || ['failed', 'error', 'rejected', 'undelivered'].includes(providerStatus);

    return {
      ok: response.ok && json?.ok !== false,
      status: failed ? 'failed' : sent ? 'sent' : 'received',
      provider: json?.provider || 'kakao_direct',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: json?.message || (sent ? '카카오 Direct API 발송 완료' : failed ? '카카오 Direct API 발송 실패' : '카카오 Direct API 요청 접수'),
      requestId: json?.requestId || json?.request_id || null,
      errorCode: failed ? (json?.errorCode || json?.error_code || `HTTP_${response.status}`) : null,
      response: json || text,
      actualSent: sent,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      provider: 'kakao_direct',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: error?.name === 'AbortError' ? '카카오 Direct API 응답이 10초를 초과했습니다.' : (error.message || '카카오 Direct API 요청 오류'),
      errorCode: error?.name === 'AbortError' ? 'KAKAO_DIRECT_TIMEOUT' : 'KAKAO_DIRECT_REQUEST_ERROR',
      actualSent: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(payload, reportSendSettings = null) {
  const adapter = getProviderAdapterStatus(payload.reportType || 'daily', reportSendSettings, payload.noticeCategory);
  const recipientDecision = applyRecipientPolicy(payload, reportSendSettings);

  if (!recipientDecision.ok) {
    return {
      ok: false,
      status: 'failed',
      provider: 'vercel-sample-webhook',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: recipientDecision.message,
      errorCode: recipientDecision.errorCode,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  const effectivePayload = recipientDecision.payload;

  if (payload.isTest || payload.actualSend === false) {
    return {
      ok: true,
      status: 'received',
      provider: 'vercel-sample-webhook',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: '테스트 요청을 수신했습니다. 실제 카카오 발송은 하지 않았습니다.',
      requestId: `test_${Date.now()}`,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  if (adapter.failSafe) {
    return {
      ok: true,
      status: 'received',
      provider: 'vercel-sample-webhook',
      providerMode: adapter.providerMode,
      failSafe: true,
      message: 'Fail-safe 모드가 켜져 있어 실제 카카오 발송을 차단하고 요청 접수로만 기록했습니다.',
      requestId: `failsafe_${Date.now()}`,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  if (adapter.providerMode === 'mock') {
    return {
      ok: true,
      status: 'received',
      provider: 'mock',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: 'mock 모드입니다. 실제 카카오 발송 없이 요청 접수 상태만 반환했습니다.',
      requestId: `mock_${Date.now()}`,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  if (adapter.providerMode === 'kakao_ready') {
    return {
      ok: true,
      status: 'received',
      provider: 'kakao_ready',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: adapter.directConfigured
        ? 'Direct Kakao API 설정이 준비되었습니다. 실제 발송하려면 KAKAO_PROVIDER_MODE=kakao 및 KAKAO_FAIL_SAFE_MODE=false로 전환하세요.'
        : 'Direct Kakao API 설정이 아직 부족합니다. API URL, API KEY, SENDER KEY, 템플릿 코드를 확인하세요.',
      requestId: `kakao_ready_${Date.now()}`,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  if (adapter.providerMode === 'kakao') {
    const directResult = await callDirectKakaoProvider(effectivePayload, adapter);
    return { ...directResult, recipientPolicy: recipientDecision.policy };
  }

  if (adapter.providerMode === 'solapi') {
    const solapiResult = await sendSolapiAlimtalk(effectivePayload);
    return {
      ...solapiResult,
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      recipientPolicy: recipientDecision.policy,
    };
  }

  if (!PROVIDER_URL) {
    return {
      ok: true,
      status: 'received',
      provider: 'vercel-sample-webhook',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: 'KAKAO_PROVIDER_WEBHOOK_URL 미설정으로 실제 카카오 발송은 하지 않고 요청 접수 상태만 반환했습니다.',
      requestId: `sample_${Date.now()}`,
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PROVIDER_SECRET ? { 'x-provider-secret': PROVIDER_SECRET } : {}),
      },
      body: JSON.stringify({
        ...effectivePayload,
        providerMode: adapter.providerMode,
        failSafe: adapter.failSafe,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return {
      ok: response.ok && json?.ok !== false,
      status: json?.status || (response.ok ? 'sent' : 'failed'),
      provider: json?.provider || 'kakao-provider',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: json?.message || (response.ok ? '카카오 제공자 서버로 전달했습니다.' : '카카오 제공자 서버 전달 실패'),
      requestId: json?.requestId || json?.request_id || null,
      errorCode: response.ok ? (json?.errorCode || json?.error_code || null) : `HTTP_${response.status}`,
      response: json || text,
      actualSent: response.ok && (json?.status ? ['sent', 'delivered', 'success', 'completed'].includes(String(json.status).toLowerCase()) : true),
      recipientPolicy: recipientDecision.policy,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      provider: 'kakao-provider',
      providerMode: adapter.providerMode,
      failSafe: adapter.failSafe,
      message: error?.name === 'AbortError' ? '카카오 제공자 서버 응답이 10초를 초과했습니다.' : (error.message || '카카오 제공자 서버 요청 오류'),
      errorCode: error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_ERROR',
      recipientPolicy: recipientDecision.policy,
      actualSent: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  try {
    if (WEBHOOK_SECRET) {
      const incomingSecret = request.headers.get('x-beyond-webhook-secret') || '';
      if (incomingSecret !== WEBHOOK_SECRET) {
        return Response.json({
          ok: false,
          status: 'failed',
          provider: 'vercel-sample-webhook',
          message: 'Webhook secret이 맞지 않습니다.',
          errorCode: 'INVALID_WEBHOOK_SECRET',
        }, { status: 401 });
      }
    }

    const payload = await request.json();
    const supabase = getSupabaseAdmin();
    const idempotencyKey = makeIdempotencyKey(payload);
    const isTest = Boolean(payload.isTest) || payload.actualSend === false || payload.mode === 'test_webhook';
    const reportSendSettingsResult = await getReportSendSettings(supabase);
    const reportSendSettings = reportSendSettingsResult.settings;
    const adapter = getProviderAdapterStatus(payload.reportType || 'daily', reportSendSettings, payload.noticeCategory);

    const existing = await findExistingRequest(supabase, idempotencyKey);
    if (existing && !isTest && shouldBlockDuplicateRequest(existing)) {
      await writeUserActionLog(supabase, request, {
        actionType: 'kakao_webhook.duplicate',
        targetType: 'kakao_webhook',
        targetId: idempotencyKey,
        targetName: payload.studentName || payload.reportType || '중복 요청',
        payload: {
          idempotencyKey,
          reportType: payload.reportType,
          studentName: payload.studentName,
          previousLogId: existing.id,
          previousStatus: existing.payload?.status || null,
          previousProviderMode: existing.payload?.providerMode || null,
          previousActualSent: existing.payload?.actualSent ?? null,
          providerMode: adapter.providerMode,
          failSafe: adapter.failSafe,
        },
      });

      return Response.json({
        ok: true,
        status: 'received',
        provider: 'vercel-sample-webhook',
        duplicate: true,
        message: '동일 idempotencyKey 요청이 이미 실제 제공자에 접수되어 중복 발송하지 않았습니다.',
        requestId: existing.id,
        idempotencyKey,
      });
    }

    if (existing && !isTest && !shouldBlockDuplicateRequest(existing)) {
      await writeUserActionLog(supabase, request, {
        actionType: 'kakao_webhook.retry_after_safe_request',
        targetType: 'kakao_webhook',
        targetId: idempotencyKey,
        targetName: payload.studentName || payload.reportType || '안전모드 이후 재시도',
        payload: {
          idempotencyKey,
          reportType: payload.reportType,
          studentName: payload.studentName,
          previousLogId: existing.id,
          previousStatus: existing.payload?.status || null,
          previousProviderMode: existing.payload?.providerMode || null,
          previousFailSafe: existing.payload?.failSafe ?? null,
          previousActualSent: existing.payload?.actualSent ?? null,
          providerMode: adapter.providerMode,
          failSafe: adapter.failSafe,
        },
      });
    }

    if (isTest) {
      await writeUserActionLog(supabase, request, {
        actionType: 'kakao_webhook.test_received',
        targetType: 'kakao_webhook',
        targetId: idempotencyKey,
        targetName: payload.studentName || '테스트 요청',
        payload: {
          idempotencyKey,
          reportType: payload.reportType,
          studentName: payload.studentName,
          actualSend: false,
          providerMode: adapter.providerMode,
          failSafe: adapter.failSafe,
        },
      });

      return Response.json({
        ok: true,
        status: 'received',
        provider: 'vercel-sample-webhook',
        message: '테스트 Webhook 요청을 정상 수신했습니다. 실제 카카오 발송은 하지 않았습니다.',
        requestId: `test_${Date.now()}`,
        idempotencyKey,
      });
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'kakao_webhook.received',
      targetType: 'kakao_webhook',
      targetId: idempotencyKey,
      targetName: payload.studentName || payload.reportType || '발송 요청',
      payload: {
        idempotencyKey,
        reportType: payload.reportType,
        studentName: payload.studentName,
        recipientPhones: normalizePhoneList(payload),
        actualSend: Boolean(payload.actualSend),
        providerMode: adapter.providerMode,
        failSafe: adapter.failSafe,
        recipientPolicy: getRecipientPolicyStatus(reportSendSettings),
      },
    });

    const providerResult = await callProvider({ ...payload, idempotencyKey }, reportSendSettings);
    const finalRecipientPolicy = providerResult.recipientPolicy || providerResult.response?.recipientPolicy || providerResult.policy || null;
    const recipientDelivery = buildRecipientDeliverySnapshot(payload, providerResult, finalRecipientPolicy);
    providerResult.recipientResults = recipientDelivery.rows;
    providerResult.recipientStats = recipientDelivery.stats;
    providerResult.partialSuccess = Boolean(providerResult.partialSuccess || recipientDelivery.stats.partialSuccess);

    if (finalRecipientPolicy?.mode === 'test_recipient_override') {
      await writeUserActionLog(supabase, request, {
        actionType: 'kakao_webhook.recipient_override',
        targetType: 'kakao_webhook',
        targetId: idempotencyKey,
        targetName: payload.studentName || payload.reportType || '테스트 수신번호 대체',
        payload: {
          idempotencyKey,
          reportType: payload.reportType,
          studentName: payload.studentName,
          originalRecipientPhones: finalRecipientPolicy.originalPhones || finalRecipientPolicy.originalRecipientPhones,
          finalRecipientPhones: finalRecipientPolicy.finalPhones || finalRecipientPolicy.finalRecipientPhones,
        },
      });
    }

    if (providerResult.errorCode === 'KAKAO_RECIPIENT_NOT_ALLOWLISTED' || providerResult.errorCode === 'KAKAO_TEST_RECIPIENT_MISSING') {
      await writeUserActionLog(supabase, request, {
        actionType: 'kakao_webhook.recipient_blocked',
        targetType: 'kakao_webhook',
        targetId: idempotencyKey,
        targetName: payload.studentName || payload.reportType || '수신번호 제한 차단',
        payload: {
          idempotencyKey,
          reportType: payload.reportType,
          studentName: payload.studentName,
          errorCode: providerResult.errorCode,
          message: providerResult.message,
          recipientPolicy: finalRecipientPolicy,
        },
      });
    }

    await writeUserActionLog(supabase, request, {
      actionType: providerResult.status === 'failed' ? 'kakao_webhook.failed' : 'kakao_webhook.forwarded',
      targetType: 'kakao_webhook',
      targetId: idempotencyKey,
      targetName: payload.studentName || payload.reportType || '발송 요청',
      payload: {
        idempotencyKey,
        reportType: payload.reportType,
        studentName: payload.studentName,
        status: providerResult.status,
        requestId: providerResult.requestId,
        errorCode: providerResult.errorCode,
        message: providerResult.message,
        actualSent: providerResult.actualSent,
        partialSuccess: providerResult.partialSuccess || false,
        recipientPolicy: finalRecipientPolicy,
        recipientResults: providerResult.recipientResults || [],
        recipientStats: providerResult.recipientStats || null,
        providerMode: providerResult.providerMode || adapter.providerMode,
        failSafe: providerResult.failSafe ?? adapter.failSafe,
      },
    });

    return Response.json({
      ...providerResult,
      idempotencyKey,
      recipientPolicy: finalRecipientPolicy,
      recipientResults: providerResult.recipientResults || [],
      recipientStats: providerResult.recipientStats || null,
      partialSuccess: providerResult.partialSuccess || false,
      providerMode: providerResult.providerMode || adapter.providerMode,
      failSafe: providerResult.failSafe ?? adapter.failSafe,
      actualSendEnabled: adapter.actualSendEnabled,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      status: 'failed',
      provider: 'vercel-sample-webhook',
      message: error.message || 'Webhook 처리 중 오류가 발생했습니다.',
      errorCode: 'WEBHOOK_HANDLER_ERROR',
    }, { status: 500 });
  }
}
