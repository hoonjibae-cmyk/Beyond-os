import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getCohortIdFromRequest, resolveScopeCohort, loadCohortStudentIds } from '../../../lib/cohortScope';
import { requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getReportSendSettings, resolveRecipientTestMode, getRecipientTestModeSource } from '../../../lib/reportSendSettings';
import { getNoticeLink } from '../../../lib/noticeShare';
import { getNoticeCategory, buildNoticeKakaoVariables } from '../../../lib/noticeTemplates';
import { normalizeNoticeAudience, getNoticeAudienceLabel, audienceIncludesParent, audienceIncludesStudent } from '../../../lib/noticeAudience';
import { getKstDateString } from '../../../lib/date';

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

// v41-202: 공지는 지금 보고 있는 기수의 수강생 학부모에게만 보냅니다.
// v41-227: 같은 처리가 위클리 발송에도 필요해져 lib/cohortScope.js 로 옮겼습니다.
async function resolveNoticeCohort(supabase, requested) {
  return resolveScopeCohort(supabase, requested, getKstDateString());
}

// 발송 대상 연락처를 모읍니다. 전화번호 기준으로 중복을 제거합니다.
//
// studentIds 가 배열이면 그 학생들로만 좁힙니다. (기수 수강 명단)
// audience
//   parent  : 수신 동의(데일리 리포트 수신 ON)된 활성 보호자   ← 기존 동작
//   student : 학생 본인 연락처(students.student_phone)
//   both    : 둘 다
//
// v41-244: 보호자를 먼저 담고 학생을 나중에 담습니다.
// 학생 번호로 보호자 번호를 등록해 둔 경우가 있어, 그때는 보호자 한 건으로만 나갑니다.
// (같은 번호로 같은 알림톡이 두 번 가는 것을 막습니다)
async function collectRecipients(supabase, studentIds = null, audience = 'parent') {
  if (Array.isArray(studentIds) && !studentIds.length) return [];
  const wantParent = audienceIncludesParent(audience);
  const wantStudent = audienceIncludesStudent(audience);

  let query = supabase
    .from('students')
    .select('id, name, status, student_phone, student_guardians(*)')
    .eq('status', 'active');
  if (Array.isArray(studentIds)) query = query.in('id', studentIds);
  const { data: students, error } = await query;
  if (error) throw error;

  const seen = new Set();
  const recipients = [];

  if (wantParent) {
    for (const student of students || []) {
      const guardians = Array.isArray(student.student_guardians) ? student.student_guardians : [];
      for (const g of guardians) {
        if (g.is_active === false) continue;
        if (g.receive_daily_report === false) continue;
        const phone = normalizePhone(g.phone);
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        recipients.push({ name: g.guardian_name || `${student.name || '학생'} 보호자`, phone, role: 'parent' });
      }
    }
  }

  if (wantStudent) {
    for (const student of students || []) {
      const phone = normalizePhone(student.student_phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      recipients.push({ name: student.name || '학생', phone, role: 'student' });
    }
  }

  return recipients;
}

function countByRole(recipients = []) {
  return {
    parentCount: recipients.filter((r) => r.role !== 'student').length,
    studentCount: recipients.filter((r) => r.role === 'student').length,
  };
}

/** 학생을 대상에 넣었는데 연락처가 없는 학생 수 (화면 경고용) */
async function countStudentsWithoutPhone(supabase, studentIds = null) {
  try {
    let query = supabase.from('students').select('id, student_phone').eq('status', 'active');
    if (Array.isArray(studentIds)) query = query.in('id', studentIds);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).filter((row) => !normalizePhone(row.student_phone)).length;
  } catch {
    return 0;
  }
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

    // v41-202: 지금 보고 있는 기수의 수강생 학부모에게만 보냅니다.
    const cohort = await resolveNoticeCohort(supabase, body.cohortId || getCohortIdFromRequest(request));
    const cohortStudentIds = cohort ? await loadCohortStudentIds(supabase, cohort.id) : null;
    // v41-244: 학부모 / 학생 / 둘 다 중에서 고릅니다. 값이 없으면 예전처럼 학부모입니다.
    const audience = normalizeNoticeAudience(body.audience);
    const audienceLabel = getNoticeAudienceLabel(audience);
    const recipients = await collectRecipients(supabase, cohortStudentIds, audience);
    const { parentCount, studentCount } = countByRole(recipients);
    const studentsWithoutPhone = audienceIncludesStudent(audience)
      ? await countStudentsWithoutPhone(supabase, cohortStudentIds)
      : 0;
    const scopeLabel = cohort ? `${cohort.name || '해당 기수'} 수강 명단` : '활성 학생 전체';
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
        audience, audienceLabel, parentCount, studentCount, studentsWithoutPhone,
        link, hasLink: contentReady,
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
        scopeLabel,
        cohortStudentCount: Array.isArray(cohortStudentIds) ? cohortStudentIds.length : null,
      });
    }

    if (!recipients.length) {
      const who = audience === 'student'
        ? '학생 본인 연락처가 없습니다. (학생 정보의 학생 연락처를 확인하세요)'
        : '수신 동의된 보호자 연락처가 없습니다. (활성 학생 · 데일리 리포트 수신 ON 기준)';
      return Response.json({
        error: cohort ? `${scopeLabel}에 ${who} 기수 관리에서 수강 명단을 확인하세요.` : who,
      }, { status: 400 });
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
      noticeAudience: audience,
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
      cohortId: cohort?.id || null,
      cohortName: cohort?.name || '',
      // 대상이 달라지면 다른 발송입니다. (학부모에게 보낸 뒤 학생에게도 보낼 수 있어야 합니다)
      idempotencyKey: `notice:${notice.id}:${cohort?.id || 'all'}:${audience}:${actualSend ? 'live' : 'test'}:${recipients.length}`,
    };

    const result = await callWebhook(payload);

    // 실제 발송이 접수되면 공지 상태 갱신 (발송 대상 스냅샷 포함 — 번호는 마스킹 저장)
    if (actualSend && result.ok) {
      const recipientSnapshot = recipients.map((r) => ({ name: r.name, phone: maskPhone(r.phone), role: r.role || 'parent' }));
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
          audience,
          audienceLabel,
          parentCount,
          studentCount,
          cohortId: cohort?.id || null,
          cohortName: cohort?.name || '',
          scopeLabel,
          recipients: recipientSnapshot,
        },
      }).eq('id', notice.id);
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'notice.send',
      targetType: 'notice',
      targetId: notice.id,
      targetName: notice.title,
      payload: {
        category: cat.key, recipientCount: recipients.length, actualSend, testMode,
        audience, audienceLabel, parentCount, studentCount,
        ok: result.ok, status: result.status,
        cohortId: cohort?.id || null, cohortName: cohort?.name || '',
      },
    });

    return Response.json({
      ok: result.ok,
      status: result.status,
      message: result.message,
      recipientCount: recipients.length,
      audience,
      audienceLabel,
      parentCount,
      studentCount,
      testMode,
      testModeSource,
      cohortId: cohort?.id || null,
      cohortName: cohort?.name || '',
      scopeLabel,
      link,
      recipientStats: result.recipientStats,
      recipientPolicy: result.recipientPolicy,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
