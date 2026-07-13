import { isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getSolapiAdapterStatus } from '../../../lib/solapiAdapter';
import { getReportSendSettings, getRecipientTestModeSource, normalizeAttendanceNotificationSettings, resolveRecipientTestMode, saveReportSendSettings } from '../../../lib/reportSendSettings';

export const dynamic = 'force-dynamic';

function envStatus(names) {
  for (const name of names) {
    if (process.env[name]) {
      return { configured: true, envName: name };
    }
  }
  return { configured: false, envName: names[0] };
}

function normalizeProviderMode(rawMode, providerConfigured, directConfigured, solapiConfigured) {
  const value = String(rawMode || '').trim().toLowerCase();
  if (['mock', 'webhook', 'kakao', 'kakao_ready', 'solapi'].includes(value)) return value;
  if (solapiConfigured) return 'solapi';
  if (directConfigured) return 'kakao';
  return providerConfigured ? 'webhook' : 'mock';
}

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
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

async function getRecipientPolicyStatus(supabase) {
  const testRecipients = parsePhoneList(process.env.KAKAO_TEST_RECIPIENT_PHONES || process.env.KAKAO_TEST_RECIPIENT_PHONE || '');
  const allowlist = parsePhoneList(process.env.KAKAO_RECIPIENT_ALLOWLIST || '');
  const envTestMode = boolEnv('KAKAO_RECIPIENT_TEST_MODE', false);
  const settingsResult = await getReportSendSettings(supabase);
  const settings = settingsResult.settings;
  const testMode = resolveRecipientTestMode(settings, envTestMode);
  const source = getRecipientTestModeSource(settings);

  return {
    testMode,
    envTestMode,
    testModeSource: source,
    dashboardOverrideActive: source === 'dashboard',
    settingExists: settingsResult.exists,
    settingWarning: settingsResult.warning,
    testRecipientConfigured: testRecipients.length > 0,
    testRecipientCount: testRecipients.length,
    allowlistConfigured: allowlist.length > 0,
    allowlistCount: allowlist.length,
    modeLabel: testMode
      ? '테스트 수신번호로 대체'
      : allowlist.length
        ? 'Allowlist 외 수신번호 차단'
        : '수신번호 제한 없음',
    notificationPolicy: settings.attendanceNotifications,
  };
}

async function getReportLinkStatus() {
  try {
    const supabase = getSupabaseAdmin();
    const { count, error } = await supabase
      .from('report_share_links')
      .select('id', { count: 'exact', head: true });

    if (error) throw error;

    return {
      configured: true,
      count: count || 0,
      message: 'report_share_links 테이블이 정상 확인되었습니다.',
    };
  } catch (error) {
    return {
      configured: false,
      count: null,
      message: `${error.message || 'report_share_links 테이블 확인 실패'} / v40-83 SQL 실행 여부를 확인하세요.`,
    };
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const supabase = getSupabaseAdmin();
  const daily = envStatus(['REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL']);
  const weekly = envStatus(['WEEKLY_REPORT_SEND_WEBHOOK_URL', 'REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL']);
  const provider = envStatus(['KAKAO_PROVIDER_WEBHOOK_URL', 'KAKAO_ALIMTALK_WEBHOOK_URL']);
  const directApi = envStatus(['KAKAO_DIRECT_API_URL']);
  const directApiKey = envStatus(['KAKAO_DIRECT_API_KEY']);
  const senderKey = envStatus(['KAKAO_SENDER_KEY']);
  const dailyTemplate = envStatus(['KAKAO_TEMPLATE_CODE_DAILY']);
  const weeklyTemplate = envStatus(['KAKAO_TEMPLATE_CODE_WEEKLY']);
  const attendanceTemplate = envStatus(['KAKAO_TEMPLATE_CODE_ATTENDANCE', 'KAKAO_TEMPLATE_CODE_CHECKINOUT']);
  const parentConfirmationTemplate = envStatus(['KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION']);
  const solapiDaily = getSolapiAdapterStatus('daily');
  const solapiWeekly = getSolapiAdapterStatus('weekly');
  const solapiAttendance = getSolapiAdapterStatus('attendance');
  const solapiParentConfirmation = getSolapiAdapterStatus('parent_confirmation');
  const solapiReady = Boolean(
    solapiDaily.apiKeyConfigured
    && solapiDaily.apiSecretConfigured
    && solapiDaily.channelConfigured
    && (solapiDaily.templateConfigured || solapiWeekly.templateConfigured || solapiAttendance.templateConfigured || solapiParentConfirmation.templateConfigured)
  );
  const providerMode = normalizeProviderMode(process.env.KAKAO_PROVIDER_MODE, provider.configured, directApi.configured, solapiReady);
  const failSafe = boolEnv('KAKAO_FAIL_SAFE_MODE', true);
  const providerSecret = envStatus(['KAKAO_PROVIDER_WEBHOOK_SECRET']);
  const webhookSecret = envStatus(['KAKAO_SEND_WEBHOOK_SECRET', 'REPORT_SEND_WEBHOOK_SECRET']);

  const webhookActualEnabled = providerMode === 'webhook'
    && provider.configured
    && !failSafe;
  const kakaoDirectReady = providerMode === 'kakao'
    && directApi.configured
    && directApiKey.configured
    && senderKey.configured
    && (dailyTemplate.configured || weeklyTemplate.configured || attendanceTemplate.configured);
  const kakaoDirectActualEnabled = kakaoDirectReady && !failSafe;
  const solapiActualEnabled = providerMode === 'solapi' && solapiReady && !failSafe;

  const actualSendEnabled = webhookActualEnabled || kakaoDirectActualEnabled || solapiActualEnabled;
  const reportLinks = await getReportLinkStatus();
  const recipientPolicy = await getRecipientPolicyStatus(supabase);
  const actualSendMethod = solapiActualEnabled ? 'solapi'
    : webhookActualEnabled ? 'provider_webhook'
      : kakaoDirectActualEnabled ? 'kakao_direct'
        : 'disabled';

  return Response.json({
    daily: {
      ...daily,
      mode: daily.configured ? (providerMode === 'solapi' ? 'solapi_adapter' : 'webhook') : 'ready_only',
      modeLabel: daily.configured ? (providerMode === 'solapi' ? 'SOLAPI Adapter 경유 모드' : 'Webhook 연동 모드') : '발송대기 저장 모드',
    },
    weekly: {
      ...weekly,
      mode: weekly.configured ? (providerMode === 'solapi' ? 'solapi_adapter' : 'webhook') : 'ready_only',
      modeLabel: weekly.configured ? (providerMode === 'solapi' ? 'SOLAPI Adapter 경유 모드' : 'Webhook 연동 모드') : '발송대기 저장 모드',
    },
    provider: {
      mode: providerMode,
      failSafe,
      actualSendEnabled,
      actualSendMethod,
      providerConfigured: provider.configured,
      providerEnvName: provider.envName,
      providerSecretConfigured: providerSecret.configured,
      providerSecretEnvName: providerSecret.envName,
      webhookSecretConfigured: webhookSecret.configured,
      webhookSecretEnvName: webhookSecret.envName,
      directApiConfigured: directApi.configured,
      directApiEnvName: directApi.envName,
      directApiKeyConfigured: directApiKey.configured,
      directApiKeyEnvName: directApiKey.envName,
      senderKeyConfigured: senderKey.configured,
      senderKeyEnvName: senderKey.envName,
      dailyTemplateConfigured: dailyTemplate.configured,
      dailyTemplateEnvName: dailyTemplate.envName,
      weeklyTemplateConfigured: weeklyTemplate.configured,
      weeklyTemplateEnvName: weeklyTemplate.envName,
      attendanceTemplateConfigured: attendanceTemplate.configured,
      attendanceTemplateEnvName: attendanceTemplate.envName,
      kakaoDirectReady,
      solapiReady,
      solapiActualEnabled,
      solapiDailyReady: solapiDaily.configured,
      solapiWeeklyReady: solapiWeekly.configured,
      solapiAttendanceReady: solapiAttendance.configured,
      solapiParentConfirmationReady: solapiParentConfirmation.configured,
      solapiApiUrl: solapiDaily.apiUrl,
      solapiApiKeyConfigured: solapiDaily.apiKeyConfigured,
      solapiApiKeyEnvName: solapiDaily.apiKeyEnvName,
      solapiApiSecretConfigured: solapiDaily.apiSecretConfigured,
      solapiApiSecretEnvName: solapiDaily.apiSecretEnvName,
      solapiChannelConfigured: solapiDaily.channelConfigured,
      solapiChannelEnvName: solapiDaily.channelEnvName,
      solapiDailyTemplateConfigured: solapiDaily.templateConfigured,
      solapiDailyTemplateEnvName: solapiDaily.templateEnvName,
      solapiWeeklyTemplateConfigured: solapiWeekly.templateConfigured,
      solapiWeeklyTemplateEnvName: solapiWeekly.templateEnvName,
      solapiAttendanceTemplateConfigured: solapiAttendance.templateConfigured,
      solapiAttendanceTemplateEnvName: solapiAttendance.templateEnvName,
      solapiParentConfirmationTemplateConfigured: solapiParentConfirmation.templateConfigured,
      solapiParentConfirmationTemplateEnvName: solapiParentConfirmation.templateEnvName,
      solapiDisableSms: solapiDaily.disableSms,
      availableModes: ['mock', 'webhook', 'kakao', 'kakao_ready', 'solapi'],
      note: actualSendEnabled
        ? '실제 발송 가능 상태입니다.'
        : '실제 발송은 차단되어 있거나 제공자 설정이 미완료 상태입니다.',
    },
    attendance: {
      configured: Boolean(attendanceTemplate.configured || solapiAttendance.templateConfigured),
      mode: providerMode === 'solapi' ? 'solapi_adapter' : attendanceTemplate.configured ? 'direct_template' : 'ready_only',
      modeLabel: providerMode === 'solapi'
        ? 'SOLAPI Adapter 경유 모드'
        : attendanceTemplate.configured
          ? 'Direct Kakao 출결 템플릿 모드'
          : '출결 템플릿 미설정',
      templateConfigured: attendanceTemplate.configured,
      templateEnvName: attendanceTemplate.envName,
      solapiTemplateConfigured: solapiAttendance.templateConfigured,
      solapiTemplateEnvName: solapiAttendance.templateEnvName,
    },
    parentConfirmation: {
      configured: Boolean(parentConfirmationTemplate.configured || solapiParentConfirmation.templateConfigured),
      mode: providerMode === 'solapi' ? 'solapi_adapter' : parentConfirmationTemplate.configured ? 'direct_template' : 'ready_only',
      modeLabel: providerMode === 'solapi'
        ? 'SOLAPI Adapter 경유 모드'
        : parentConfirmationTemplate.configured
          ? 'Direct Kakao 학부모 확인 요청 템플릿 모드'
          : '학부모 확인 요청 템플릿 미설정',
      templateConfigured: parentConfirmationTemplate.configured,
      templateEnvName: parentConfirmationTemplate.envName,
      solapiTemplateConfigured: solapiParentConfirmation.templateConfigured,
      solapiTemplateEnvName: solapiParentConfirmation.templateEnvName,
    },
    reportLinks,
    recipientPolicy,
    notificationPolicy: recipientPolicy.notificationPolicy,
    availableModes: ['manual_copy', 'ready_only', 'webhook', 'kakao_api_prepare', 'solapi'],
    sampleEndpoint: '/api/kakao-send-webhook',
    note: '웹훅 값과 API 키는 보안상 노출하지 않고 연결 여부와 환경변수 이름만 표시합니다.',
  });
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();
    const currentResult = await getReportSendSettings(supabase);
    const currentSettings = currentResult.settings;

    if (action === 'set_recipient_test_mode') {
      if (typeof body.testMode !== 'boolean') {
        return Response.json({ error: 'testMode boolean is required' }, { status: 400 });
      }

      const settings = await saveReportSendSettings(supabase, {
        ...currentSettings,
        recipientTestMode: body.testMode,
      });
      const recipientPolicy = await getRecipientPolicyStatus(supabase);

      return Response.json({
        ok: true,
        settings,
        recipientPolicy,
        notificationPolicy: settings.attendanceNotifications,
        message: body.testMode ? '리포트 발송 테스트모드를 ON으로 전환했습니다.' : '리포트 발송 테스트모드를 OFF로 전환했습니다.',
      });
    }

    if (action === 'set_attendance_notification_settings') {
      const nextNotificationSettings = normalizeAttendanceNotificationSettings({
        ...currentSettings.attendanceNotifications,
        ...(body.settings || {}),
      });
      const settings = await saveReportSendSettings(supabase, {
        ...currentSettings,
        attendanceNotifications: nextNotificationSettings,
      });
      const recipientPolicy = await getRecipientPolicyStatus(supabase);

      return Response.json({
        ok: true,
        settings,
        recipientPolicy,
        notificationPolicy: settings.attendanceNotifications,
        message: '출결 알림 설정을 저장했습니다.',
      });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: `${error.message || '리포트/출결 알림 설정 저장 실패'} / system_settings 테이블이 필요합니다. beyond-os-supabase-operating-rules-v40-6.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

