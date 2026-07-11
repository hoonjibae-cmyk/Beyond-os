import crypto from 'crypto';
import { getKakaoVariables, validateKakaoTemplateVariables } from './reportTemplateValidation';

const DEFAULT_SOLAPI_SEND_ENDPOINT = 'https://api.solapi.com/messages/v4/send-many/detail';
const SOLAPI_TIMEOUT_MS = 10000;

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

function envStatus(names) {
  for (const name of names) {
    if (process.env[name]) return { configured: true, envName: name, value: process.env[name] };
  }
  return { configured: false, envName: names[0], value: '' };
}

function normalizeReportType(value) {
  if (value === 'weekly') return 'weekly';
  if (value === 'attendance') return 'attendance';
  if (value === 'parent_confirmation') return 'parent_confirmation';
  return 'daily';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function uniqueByPhone(recipients) {
  const seen = new Set();
  return recipients.filter((item) => {
    if (!item.phone || seen.has(item.phone)) return false;
    seen.add(item.phone);
    return true;
  });
}

function normalizeRecipients(payload = {}) {
  const fromRecipients = Array.isArray(payload.recipients)
    ? payload.recipients.map((item, index) => ({
      name: item?.name || item?.relationship || `수신자 ${index + 1}`,
      relationship: item?.relationship || '',
      phone: normalizePhone(item?.phone),
      isPrimary: Boolean(item?.isPrimary),
    }))
    : [];

  const fromPhones = [];
  if (Array.isArray(payload.recipientPhones)) fromPhones.push(...payload.recipientPhones);
  if (Array.isArray(payload.to)) fromPhones.push(...payload.to);
  if (payload.recipientPhone) fromPhones.push(payload.recipientPhone);

  const recipients = fromRecipients.length
    ? fromRecipients
    : fromPhones.map((phone, index) => ({
      name: `수신자 ${index + 1}`,
      relationship: '',
      phone: normalizePhone(phone),
      isPrimary: index === 0,
    }));

  return uniqueByPhone(recipients.filter((item) => item.phone));
}

function getTemplateEnv(reportType) {
  const type = normalizeReportType(reportType);
  if (type === 'weekly') return envStatus(['SOLAPI_TEMPLATE_ID_WEEKLY']);
  if (type === 'attendance') return envStatus(['SOLAPI_TEMPLATE_ID_ATTENDANCE', 'SOLAPI_TEMPLATE_ID_CHECKINOUT']);
  if (type === 'parent_confirmation') return envStatus(['SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION']);
  return envStatus(['SOLAPI_TEMPLATE_ID_DAILY']);
}

export function getSolapiConfig(reportType = 'daily') {
  const apiKey = envStatus(['SOLAPI_API_KEY']);
  const apiSecret = envStatus(['SOLAPI_API_SECRET']);
  const channel = envStatus(['SOLAPI_CHANNEL_ID', 'SOLAPI_PF_ID']);
  const template = getTemplateEnv(reportType);
  const from = envStatus(['SOLAPI_SENDER_PHONE', 'SOLAPI_FROM']);
  const apiUrl = process.env.SOLAPI_API_URL || DEFAULT_SOLAPI_SEND_ENDPOINT;

  return {
    apiUrl,
    apiKey: apiKey.value,
    apiSecret: apiSecret.value,
    channelId: channel.value,
    templateId: template.value,
    from: normalizePhone(from.value),
    disableSms: boolEnv('SOLAPI_DISABLE_SMS', true),
    showMessageList: boolEnv('SOLAPI_SHOW_MESSAGE_LIST', true),
    apiKeyEnvName: apiKey.envName,
    apiSecretEnvName: apiSecret.envName,
    channelEnvName: channel.envName,
    templateEnvName: template.envName,
    fromEnvName: from.envName,
    apiKeyConfigured: apiKey.configured,
    apiSecretConfigured: apiSecret.configured,
    channelConfigured: channel.configured,
    templateConfigured: template.configured,
    fromConfigured: from.configured,
  };
}

export function getSolapiAdapterStatus(reportType = 'daily') {
  const type = normalizeReportType(reportType);
  const config = getSolapiConfig(type);
  return {
    provider: 'solapi',
    reportType: type,
    apiUrlConfigured: Boolean(config.apiUrl),
    apiUrl: config.apiUrl,
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeyEnvName: config.apiKeyEnvName,
    apiSecretConfigured: config.apiSecretConfigured,
    apiSecretEnvName: config.apiSecretEnvName,
    channelConfigured: config.channelConfigured,
    channelEnvName: config.channelEnvName,
    templateConfigured: config.templateConfigured,
    templateEnvName: config.templateEnvName,
    fromConfigured: config.fromConfigured,
    fromEnvName: config.fromEnvName,
    disableSms: config.disableSms,
    showMessageList: config.showMessageList,
    configured: Boolean(
      config.apiUrl
      && config.apiKeyConfigured
      && config.apiSecretConfigured
      && config.channelConfigured
      && config.templateConfigured
    ),
  };
}

function missingSolapiConfig(config = {}) {
  const missing = [];
  if (!config.apiUrl) missing.push('SOLAPI_API_URL');
  if (!config.apiKeyConfigured) missing.push('SOLAPI_API_KEY');
  if (!config.apiSecretConfigured) missing.push('SOLAPI_API_SECRET');
  if (!config.channelConfigured) missing.push('SOLAPI_CHANNEL_ID 또는 SOLAPI_PF_ID');
  if (!config.templateConfigured) missing.push(config.templateEnvName || 'SOLAPI_TEMPLATE_ID_DAILY/WEEKLY/ATTENDANCE');
  return missing;
}

export function makeSolapiAuthorizationHeader(apiKey, apiSecret, date = new Date().toISOString(), salt = crypto.randomBytes(32).toString('hex')) {
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${date}${salt}`)
    .digest('hex');

  return {
    date,
    salt,
    authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
  };
}

function stringifyVariables(variables = {}) {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)])
  );
}

export function buildSolapiRequestBody(payload = {}, config = getSolapiConfig(payload.reportType)) {
  const reportType = normalizeReportType(payload.reportType);
  const recipients = normalizeRecipients(payload);
  const variables = stringifyVariables(getKakaoVariables(payload, reportType));

  const messages = recipients.map((recipient) => {
    const message = {
      to: recipient.phone,
      type: 'ATA',
      autoTypeDetect: true,
      kakaoOptions: {
        pfId: config.channelId,
        templateId: config.templateId,
        disableSms: config.disableSms,
        variables,
      },
    };

    if (config.from) message.from = config.from;
    return message;
  });

  return {
    messages,
    showMessageList: config.showMessageList,
    allowDuplicates: false,
  };
}

function getCountValue(count = {}, names = []) {
  for (const name of names) {
    const value = count?.[name];
    if (value !== undefined && value !== null && !Number.isNaN(Number(value))) return Number(value);
  }
  return 0;
}

function getSolapiCount(json = {}) {
  return json?.groupInfo?.count || json?.count || {};
}

function getSolapiRequestId(json = {}) {
  return json?.groupInfo?.groupId
    || json?.groupInfo?._id
    || json?.groupId
    || json?._id
    || json?.messageId
    || json?.messageList?.[0]?.messageId
    || json?.failedMessageList?.[0]?.messageId
    || null;
}

function getSolapiMessagePhone(item = {}) {
  return normalizePhone(
    item.to
    || item.phone
    || item.recipientPhone
    || item.targetPhone
    || item.message?.to
    || item.message?.phone
    || item.message?.recipientPhone
  );
}

function getSolapiMessageId(item = {}) {
  return item.messageId || item.message_id || item._id || item.message?._id || item.message?.messageId || null;
}

function getSolapiMessageError(item = {}) {
  return item.statusMessage
    || item.errorMessage
    || item.error_message
    || item.message
    || item.reason
    || item.resultMessage
    || null;
}

function buildSolapiRecipientResults(recipients = [], failedList = [], messageList = [], status = 'received') {
  const failedByPhone = new Map();
  const failedByMessageId = new Map();
  for (const failed of failedList || []) {
    const phone = getSolapiMessagePhone(failed);
    const messageId = getSolapiMessageId(failed);
    if (phone) failedByPhone.set(phone, failed);
    if (messageId) failedByMessageId.set(messageId, failed);
  }

  const messageByPhone = new Map();
  for (const message of messageList || []) {
    const phone = getSolapiMessagePhone(message);
    if (phone && !messageByPhone.has(phone)) messageByPhone.set(phone, message);
  }

  const fallbackFailedSingle = recipients.length === 1 && failedList?.length === 1 ? failedList[0] : null;
  return (recipients || []).map((recipient) => {
    const message = messageByPhone.get(recipient.phone) || {};
    const messageId = getSolapiMessageId(message);
    const failed = failedByPhone.get(recipient.phone) || (messageId ? failedByMessageId.get(messageId) : null) || fallbackFailedSingle;
    const providerStatus = String(message.status || message.statusCode || message.resultStatus || '').toLowerCase();
    const deliveryStatus = failed
      ? 'failed'
      : status === 'sent'
        ? 'sent'
        : providerStatus.includes('fail')
          ? 'failed'
          : ['complete', 'sent', 'delivered', 'success'].some((word) => providerStatus.includes(word))
            ? 'sent'
            : 'received';

    return {
      name: recipient.name || recipient.relationship || '수신자',
      relationship: recipient.relationship || '',
      phone: recipient.phone,
      status: deliveryStatus,
      providerStatus: failed ? String(failed.status || failed.statusCode || 'failed') : providerStatus || status,
      messageId: messageId || getSolapiMessageId(failed || {}),
      errorMessage: failed ? getSolapiMessageError(failed) : null,
    };
  });
}

function summarizeRecipientResults(results = []) {
  const total = results.length;
  const failed = results.filter((item) => item.status === 'failed').length;
  const sent = results.filter((item) => item.status === 'sent').length;
  const received = results.filter((item) => item.status === 'received').length;
  return {
    total,
    sent,
    received,
    failed,
    successLike: sent + received,
    partialSuccess: failed > 0 && sent + received > 0,
  };
}

function mapSolapiResponse(response, json = null, text = '', recipients = []) {
  const count = getSolapiCount(json || {});
  const failedList = Array.isArray(json?.failedMessageList) ? json.failedMessageList : [];
  const groupStatus = String(json?.groupInfo?.status || json?.status || '').toUpperCase();
  const registeredSuccess = getCountValue(count, ['registeredSuccess', 'registerSuccess']);
  const registeredFailed = getCountValue(count, ['registeredFailed', 'registerFailed']);
  const sentSuccess = getCountValue(count, ['sentSuccess']);
  const sentFailed = getCountValue(count, ['sentFailed']);
  const sentPending = getCountValue(count, ['sentPending']);
  const sentTotal = getCountValue(count, ['sentTotal']);
  const total = getCountValue(count, ['total']);
  const requestId = getSolapiRequestId(json || {});
  const failedMessage = failedList[0]?.statusMessage || failedList[0]?.message || null;

  let status = 'received';
  let errorCode = null;
  let ok = response.ok;

  if (!response.ok) {
    status = 'failed';
    ok = false;
    errorCode = json?.errorCode || json?.error_code || json?.code || `SOLAPI_HTTP_${response.status}`;
  } else if (['FAILED', 'DELETED'].includes(groupStatus)) {
    status = 'failed';
    ok = false;
    errorCode = json?.errorCode || json?.error_code || 'SOLAPI_GROUP_FAILED';
  } else if (failedList.length || registeredFailed || sentFailed) {
    const successCount = registeredSuccess + sentSuccess + sentPending;
    if (successCount > 0) {
      status = 'failed';
      ok = false;
      errorCode = 'SOLAPI_PARTIAL_FAILED';
    } else {
      status = 'failed';
      ok = false;
      errorCode = json?.errorCode || json?.error_code || 'SOLAPI_REGISTERED_FAILED';
    }
  } else if (groupStatus === 'COMPLETE' && (sentSuccess > 0 || registeredSuccess > 0 || sentTotal > 0 || total > 0)) {
    status = 'sent';
  } else if (response.ok && (registeredSuccess > 0 || sentPending > 0 || sentTotal > 0 || total > 0 || ['PENDING', 'SENDING', 'SCHEDULED'].includes(groupStatus))) {
    status = 'received';
  }

  const messageList = Array.isArray(json?.messageList) ? json.messageList : [];
  const recipientResults = buildSolapiRecipientResults(recipients, failedList, messageList, status);
  const recipientStats = summarizeRecipientResults(recipientResults);

  return {
    ok,
    status,
    providerStatus: groupStatus || (response.ok ? 'received' : 'failed'),
    requestId,
    errorCode,
    message: recipientStats.partialSuccess
      ? 'SOLAPI 알림톡 일부 수신자 발송에 실패했습니다. 실패 수신자만 확인 후 재발송하세요.'
      : status === 'sent'
        ? 'SOLAPI 알림톡 발송 완료로 응답되었습니다.'
        : status === 'failed'
          ? (failedMessage || json?.message || 'SOLAPI 알림톡 발송 요청이 실패했습니다.')
          : 'SOLAPI 알림톡 발송 요청이 접수되었습니다. 실제 완료 전까지 발송대기로 기록합니다.',
    response: json || text,
    httpStatus: response.status,
    solapiGroupStatus: groupStatus || null,
    solapiCount: count,
    failedMessageList: failedList,
    recipientResults,
    recipientStats,
    partialSuccess: recipientStats.partialSuccess,
    actualSent: status === 'sent',
  };
}

export async function sendSolapiAlimtalk(payload = {}, options = {}) {
  const reportType = normalizeReportType(payload.reportType);
  const config = options.config || getSolapiConfig(reportType);
  const status = getSolapiAdapterStatus(reportType);
  const missing = missingSolapiConfig(config);
  const recipients = normalizeRecipients(payload);

  if (missing.length) {
    return {
      ok: false,
      configured: false,
      status: 'failed',
      provider: 'solapi',
      providerStatus: 'config_missing',
      message: `SOLAPI 설정이 부족합니다: ${missing.join(', ')}`,
      errorCode: 'SOLAPI_CONFIG_MISSING',
      missingConfig: missing,
      actualSent: false,
    };
  }

  if (!recipients.length) {
    return {
      ok: false,
      configured: status.configured,
      status: 'failed',
      provider: 'solapi',
      providerStatus: 'recipient_missing',
      message: 'SOLAPI 알림톡 수신번호가 없습니다.',
      errorCode: 'SOLAPI_RECIPIENT_MISSING',
      actualSent: false,
    };
  }

  const templateValidation = payload.templateValidation || validateKakaoTemplateVariables(payload, reportType);
  if (!templateValidation.ok) {
    return {
      ok: false,
      configured: status.configured,
      status: 'failed',
      provider: 'solapi',
      providerStatus: 'template_variable_invalid',
      message: `SOLAPI 알림톡 필수 변수가 누락되었습니다: ${templateValidation.missing.join(', ')}`,
      errorCode: 'SOLAPI_TEMPLATE_VARIABLE_INVALID',
      templateValidation,
      actualSent: false,
    };
  }

  const requestBody = buildSolapiRequestBody(payload, config);
  const auth = makeSolapiAuthorizationHeader(config.apiKey, config.apiSecret);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOLAPI_TIMEOUT_MS);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const result = mapSolapiResponse(response, json, text, recipients);
    return {
      ...result,
      configured: true,
      provider: 'solapi',
      reportType,
      recipientCount: recipients.length,
      recipientPhones: recipients.map((item) => item.phone),
      requestBodyPreview: {
        messages: requestBody.messages.map((message) => ({
          ...message,
          kakaoOptions: {
            ...message.kakaoOptions,
            pfId: message.kakaoOptions.pfId ? '[configured]' : '',
            templateId: message.kakaoOptions.templateId ? '[configured]' : '',
          },
        })),
        showMessageList: requestBody.showMessageList,
        allowDuplicates: requestBody.allowDuplicates,
      },
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: 'failed',
      provider: 'solapi',
      providerStatus: 'request_error',
      message: error?.name === 'AbortError'
        ? 'SOLAPI 응답이 10초를 초과했습니다.'
        : (error.message || 'SOLAPI 요청 중 오류가 발생했습니다.'),
      errorCode: error?.name === 'AbortError' ? 'SOLAPI_TIMEOUT' : 'SOLAPI_REQUEST_ERROR',
      actualSent: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
