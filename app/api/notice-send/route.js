import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getReportSendSettings, resolveRecipientTestMode, getRecipientTestModeSource } from '../../../lib/reportSendSettings';
import { getNoticeLink } from '../../../lib/noticeShare';
import { getNoticeCategory, buildNoticeKakaoVariables } from '../../../lib/noticeTemplates';

export const dynamic = 'force-dynamic';

const WEBHOOK_URL = process.env.REPORT_SEND_WEBHOOK_URL || process.env.KAKAO_REPORT_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.REPORT_SEND_WEBHOOK_SECRET || process.env.KAKAO_SEND_WEBHOOK_SECRET || '';
const WEBHOOK_TIMEOUT_MS = 15000;

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

// 활성 학생의 수신 동의(데일리 리포트 수신) 보호자 → 전화번호 기준 중복 제거
async function collectRecipients(supabase) {
  const { data: students, error } = await supabase
    .from('students')
    .select('name, status, student_guardians(*)')
    .eq('status', 'active');
  if (error) throw error;

  const seen = new Set();
  const recipients = [];
  for (const student of students || []) {
    const guardians = Array.isArray(student.student_guardians) ? student.student_guardians : [];
    for (const g of guardians) {
      if (g.is_active === false) continue;
      if (g.receive_daily_report === false) continue;
      const phone = normalizePhone(g.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      recipients.push({ name: g.guardian_name || `${student.name || '학생'} 보호자`, phone });
    }
  }
  return recipients;
}

async function callWebhook(payload) {
  if (!WEBHOOK_URL) {
    return { configured: false, ok: false, status: 'ready', message: 'REPORT_SEND_WEBHOOK_URL이 설정되지 않아 발송할 수 없습니다.', errorCode: 'WEBHOOK_NOT_CONFIGURED' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(WEBHOOK_SECRET ? { 'x-beyond-webhook-secret': WEBHOOK_SECRET } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const bodyOk = typeof json?.ok === 'boolean' ? json.ok : response.ok;
    const providerStatus = String(json?.status || '').toLowerCase();
    const ok = Boolean(response.ok && bodyOk !== false && providerStatus !== 'failed');
    return {
      configured: true,
      ok,
      status: providerStatus || (response.ok ? 'received' : 'failed'),
      provider: json?.provider || 'webhook',
      message: json?.message || (ok ? '카카오 알림톡 발송이 접수되었습니다.' : '카카오 알림톡 발송 요청이 실패했습니다.'),
      recipientPolicy: json?.recipientPolicy || null,
      recipientStats: json?.recipientStats || null,
      httpStatus: response.status,
      raw: json || text,
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return { configured: true, ok: false, status: 'failed', message: timedOut ? '발송 서버 응답 시간 초과' : (error.message || 'Webhook 요청 오류'), errorCode: timedOut ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_REQUEST_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    const noticeId = body.noticeId;
    const previewOnly = Boolean(body.previewOnly);
    const actualSend = body.actualSend === true;
    if (!noticeId) return Response.json({ error: 'noticeId가 필요합니다.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: notice, error: noticeError } = await supabase.from('notices').select('*').eq('id', noticeId).maybeSingle();
    if (noticeError) throw noticeError;
    if (!notice) return Response.json({ error: '공지를 찾을 수 없습니다.' }, { status: 404 });

    const recipients = await collectRecipients(supabase);
    const sendSettings = await getReportSendSettings(supabase).catch(() => ({}));
    const testMode = resolveRecipientTestMode(sendSettings?.settings || sendSettings || {}, String(process.env.KAKAO_RECIPIENT_TEST_MODE || '').toLowerCase() === 'true');
    const testModeSource = getRecipientTestModeSource(sendSettings?.settings || sendSettings || {});

    const category = notice.category || 'operating_rules';
    const cat = getNoticeCategory(category);
    const isFields = cat.input === 'fields';
    const templateData = notice.template_data || {};

    // 링크형: 웹링크 필요 / 필드형: 항목값(기간·사유·내용) 필요
    const link = isFields ? '' : getNoticeLink(request, notice);
    const missingFields = isFields ? cat.fields.filter((f) => !String(templateData[f.key] || '').trim()) : [];
    const contentReady = isFields ? missingFields.length === 0 : Boolean(link);

    // 미리보기: 실제 발송 없이 대상 수/모드만 반환
    if (previewOnly) {
      return Response.json({
        preview: true, recipientCount: recipients.length, testMode, testModeSource,
        category: cat.key, categoryLabel: cat.label, input: cat.input,
        link, hasLink: contentReady,
      });
    }

    if (!recipients.length) {
      return Response.json({ error: '수신 동의된 보호자 연락처가 없습니다. (활성 학생 · 데일리 리포트 수신 ON 기준)' }, { status: 400 });
    }
    if (!contentReady) {
      return Response.json({
        error: isFields
          ? `발송 항목이 비어 있습니다: ${missingFields.map((f) => f.label).join(', ')}`
          : '공지 링크를 만들 수 없습니다. 본문을 저장했는지, 또는 외부 URL이 올바른지 확인하세요.',
      }, { status: 400 });
    }

    const kakaoVariables = buildNoticeKakaoVariables(cat.key, { link, title: notice.title, data: templateData });

    const payload = {
      reportType: 'notice',
      noticeCategory: cat.key,
      actualSend,
      isTest: !actualSend,
      recipients,
      recipientPhones: recipients.map((r) => r.phone),
      reportLink: link,
      noticeTitle: notice.title,
      templateVariables: {
        noticeTitle: notice.title,
        noticeLink: link,
        reportLink: link,
        noticeCategory: cat.key,
        noticeData: templateData,
        kakaoVariables,
      },
      idempotencyKey: `notice:${notice.id}:${actualSend ? 'live' : 'test'}:${recipients.length}`,
    };

    const result = await callWebhook(payload);

    // 실제 발송이 접수되면 공지 상태 갱신 (발송 대상 스냅샷 포함 — 번호는 마스킹 저장)
    if (actualSend && result.ok) {
      const recipientSnapshot = recipients.map((r) => ({ name: r.name, phone: maskPhone(r.phone) }));
      await supabase.from('notices').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: recipients.length,
        last_send_summary: {
          at: new Date().toISOString(),
          recipientCount: recipients.length,
          testMode,
          status: result.status,
          category: cat.key,
          categoryLabel: cat.label,
          recipients: recipientSnapshot,
        },
      }).eq('id', notice.id);
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'notice.send',
      targetType: 'notice',
      targetId: notice.id,
      targetName: notice.title,
      payload: { category: cat.key, recipientCount: recipients.length, actualSend, testMode, ok: result.ok, status: result.status },
    });

    return Response.json({
      ok: result.ok,
      status: result.status,
      message: result.message,
      recipientCount: recipients.length,
      testMode,
      testModeSource,
      link,
      recipientStats: result.recipientStats,
      recipientPolicy: result.recipientPolicy,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
