// Beyond OS v41-203 — 학부모 시간표 확인 링크를 카카오 알림톡으로 발송
//
// 학생 시간표 화면에서 [학부모 확인 링크 만들기]로 만들어 둔 링크(/s/{token})를
// 학생별 보호자에게 알림톡으로 보냅니다. 링크는 학생마다 다르므로 한 건씩 보냅니다.
//
// 발송 대상은 지금 보고 있는 기수의 확인 요청입니다.
// 이미 확인/수정 제출이 끝난 학생은 기본적으로 건너뜁니다. (resend 로 다시 보낼 수 있습니다)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import {
  SCHEDULE_CONFIRM_REPORT_TYPE,
  SCHEDULE_CONFIRM_TEMPLATE,
  buildScheduleConfirmKakaoVariables,
  buildScheduleConfirmMessage,
  formatConfirmPeriod,
} from '../../../lib/scheduleConfirmTemplate';

export const dynamic = 'force-dynamic';

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function normalizeAction(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'send' ? 'send' : 'preview';
}

function getCohortIdFromRequest(request) {
  try {
    return String(request?.headers?.get?.('x-beyond-cohort-id') || '').trim();
  } catch {
    return '';
  }
}

// 공지 발송과 같은 규칙: 요청 기수 → 오늘이 속한 기수 → 가장 최근 기수.
async function resolveCohort(supabase, requested) {
  let rows = [];
  try {
    const { data, error } = await supabase
      .from('cohorts')
      .select('id, name, start_date, end_date')
      .order('start_date', { ascending: true });
    if (error) throw error;
    rows = data || [];
  } catch {
    return null;
  }
  if (!rows.length) return null;

  const wanted = String(requested || '').trim();
  const picked = wanted ? rows.find((row) => String(row.id) === wanted) : null;
  if (picked) return { id: String(picked.id), name: picked.name || '' };

  const today = getKstDateString();
  const current = [...rows].reverse().find((row) => (
    String(row.start_date || '').slice(0, 10) <= today && today <= String(row.end_date || '').slice(0, 10)
  ));
  if (current) return { id: String(current.id), name: current.name || '' };

  const latest = rows[rows.length - 1];
  return { id: String(latest.id), name: latest.name || '' };
}

// 공개 링크 주소. 확인 링크를 만들 때(schedule-confirm 의 create_links)와 같은 방식이어야
// 목록에 보이는 주소와 알림톡으로 나가는 주소가 같습니다.
function getPublicBaseUrl(request) {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host') || process.env.VERCEL_URL || '';
  if (!host) return '';
  const proto = request?.headers?.get?.('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function guardiansOf(student) {
  const rows = Array.isArray(student?.student_guardians) ? student.student_guardians : [];
  const active = rows
    .filter((item) => item?.is_active !== false && normalizePhone(item.phone))
    .map((item, index) => ({
      name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
      relationship: item.relationship || '',
      phone: normalizePhone(item.phone),
      isPrimary: Boolean(item.is_primary),
    }));
  if (active.length) return dedupeByPhone(active);

  // 보호자 목록이 없으면 학생 레코드의 대표 번호로 폴백합니다.
  const fallback = normalizePhone(student?.parent_phone);
  return fallback ? [{ name: '대표 보호자', relationship: '대표 보호자', phone: fallback, isPrimary: true }] : [];
}

function dedupeByPhone(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.phone)) return false;
    seen.add(item.phone);
    return true;
  });
}

async function callKakaoSendWebhook(request, payload) {
  const url = new URL('/api/kakao-send-webhook', request.url);
  const headers = { 'Content-Type': 'application/json' };
  const secret = process.env.KAKAO_SEND_WEBHOOK_SECRET || process.env.REPORT_SEND_WEBHOOK_SECRET || '';
  if (secret) headers['x-beyond-webhook-secret'] = secret;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아니어도 상태만 보면 됩니다. */ }
  return { ok: response.ok, body: json || { raw: text } };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = normalizeAction(body.action);
    // 이미 확인/수정 제출이 끝난 학생에게도 다시 보낼지
    const resend = body.resend === true;
    const onlyIds = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const actor = getAuthorizedUser(request);
    const actorName = body.adminName || actor?.displayName || '관리자';

    const supabase = getSupabaseAdmin();
    const cohort = await resolveCohort(supabase, body.cohortId || getCohortIdFromRequest(request));

    let query = supabase
      .from('schedule_confirmations')
      .select('id, token, student_id, cohort_id, start_date, end_date, status, confirmed_at')
      .order('created_at', { ascending: true });
    if (cohort) query = query.eq('cohort_id', cohort.id);
    if (onlyIds.length) query = query.in('id', onlyIds);
    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const confirmations = rows || [];
    if (!confirmations.length) {
      return Response.json({
        error: cohort
          ? `${cohort.name || '해당 기수'}에 만들어 둔 학부모 확인 링크가 없습니다. 먼저 [학부모 확인 링크 만들기]를 눌러 주세요.`
          : '만들어 둔 학부모 확인 링크가 없습니다. 먼저 [학부모 확인 링크 만들기]를 눌러 주세요.',
      }, { status: 400 });
    }

    const studentIds = [...new Set(confirmations.map((row) => String(row.student_id)))];
    const { data: studentRows, error: studentError } = await supabase
      .from('students')
      .select('id, name, status, parent_phone, student_guardians(*)')
      .in('id', studentIds);
    if (studentError) throw studentError;
    const studentById = new Map((studentRows || []).map((row) => [String(row.id), row]));

    const base = getPublicBaseUrl(request);
    const targets = [];
    const skipped = [];

    for (const row of confirmations) {
      const student = studentById.get(String(row.student_id)) || {};
      const studentName = student.name || '학생';

      if (student.status === 'inactive') {
        skipped.push({ id: row.id, studentName, reason: '비활성 학생' });
        continue;
      }
      if (!resend && row.status !== 'pending') {
        skipped.push({
          id: row.id,
          studentName,
          reason: row.status === 'confirmed' ? '이미 확인 완료' : '이미 수정 요청 제출',
        });
        continue;
      }
      const link = base ? `${base}/s/${row.token}` : '';
      if (!link) {
        skipped.push({ id: row.id, studentName, reason: '링크 주소를 만들 수 없음' });
        continue;
      }
      const recipients = guardiansOf(student);
      if (!recipients.length) {
        skipped.push({ id: row.id, studentName, reason: '보호자 연락처 없음' });
        continue;
      }

      targets.push({
        id: row.id,
        studentId: String(row.student_id),
        studentName,
        status: row.status,
        link,
        period: formatConfirmPeriod(row.start_date, row.end_date),
        startDate: row.start_date,
        endDate: row.end_date,
        recipients,
      });
    }

    const recipientCount = targets.reduce((sum, item) => sum + item.recipients.length, 0);

    if (action === 'preview') {
      const sampleTarget = targets[0] || null;
      return Response.json({
        ok: true,
        mode: 'preview',
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
        templateEnvName: SCHEDULE_CONFIRM_TEMPLATE.templateIdEnvs[0],
        reportType: SCHEDULE_CONFIRM_REPORT_TYPE,
        studentCount: targets.length,
        recipientCount,
        targets: targets.map((item) => ({
          id: item.id,
          studentName: item.studentName,
          period: item.period,
          link: item.link,
          status: item.status,
          recipients: item.recipients.map((r) => ({ name: r.name, phoneMasked: maskPhone(r.phone) })),
        })),
        skipped,
        sampleMessage: sampleTarget ? buildScheduleConfirmMessage(sampleTarget) : '',
        sampleVariables: sampleTarget ? buildScheduleConfirmKakaoVariables(sampleTarget) : null,
      });
    }

    if (!targets.length) {
      return Response.json({
        error: '보낼 대상이 없습니다. 아래 제외 사유를 확인하세요.',
        skipped,
      }, { status: 400 });
    }

    const requestedAt = new Date().toISOString();
    const results = [];
    let sentStudents = 0;
    let sentRecipients = 0;

    for (const target of targets) {
      const kakaoVariables = buildScheduleConfirmKakaoVariables(target);
      const payload = {
        channel: 'kakao',
        reportType: SCHEDULE_CONFIRM_REPORT_TYPE,
        notificationType: SCHEDULE_CONFIRM_REPORT_TYPE,
        studentId: target.studentId,
        studentName: target.studentName,
        reportId: target.id,
        startDate: target.startDate,
        endDate: target.endDate,
        recipientPhones: target.recipients.map((item) => item.phone),
        recipients: target.recipients,
        reportLink: target.link,
        messageText: buildScheduleConfirmMessage(target),
        templateVariables: {
          kakaoVariables,
          studentName: target.studentName,
          period: target.period,
          confirmLink: target.link,
          reportLink: target.link,
        },
        // 같은 링크를 다시 보내는 것은 재발송이므로 시각을 넣어 구분합니다.
        idempotencyKey: `schedule_confirm:${target.id}:${requestedAt}`,
        actualSend: true,
        requestedBy: actorName,
        requestedAt,
        metadata: {
          source: 'schedule_confirm_send',
          cohortId: cohort?.id || null,
          cohortName: cohort?.name || '',
          confirmationId: target.id,
        },
      };

      let result = null;
      try {
        const { ok, body: sendBody } = await callKakaoSendWebhook(request, payload);
        const status = sendBody?.status === 'failed' || ok === false ? 'failed' : (sendBody?.status || 'received');
        result = {
          id: target.id,
          studentName: target.studentName,
          ok: ok && status !== 'failed',
          status,
          message: sendBody?.message || '',
          recipientCount: target.recipients.length,
        };
      } catch (error) {
        result = {
          id: target.id,
          studentName: target.studentName,
          ok: false,
          status: 'failed',
          message: error?.message || '발송 요청 오류',
          recipientCount: target.recipients.length,
        };
      }

      if (result.ok) {
        sentStudents += 1;
        sentRecipients += target.recipients.length;
        // 발송 기록. 컬럼이 아직 없으면(마이그레이션 전) 조용히 넘어갑니다.
        try {
          await supabase.from('schedule_confirmations').update({
            sent_at: requestedAt,
            last_send_summary: {
              at: requestedAt,
              by: actorName,
              status: result.status,
              recipientCount: target.recipients.length,
              recipients: target.recipients.map((r) => ({ name: r.name, phone: maskPhone(r.phone) })),
            },
          }).eq('id', target.id);
        } catch {
          // sent_at / last_send_summary 컬럼이 없어도 발송 자체는 끝난 것으로 봅니다.
        }
      }
      results.push(result);
    }

    const failed = results.filter((item) => !item.ok);

    await writeUserActionLog(supabase, request, {
      actionType: 'schedule_confirm.send',
      targetType: 'schedule_confirmation',
      targetId: cohort?.id || null,
      targetName: `${cohort?.name || '전체'} 시간표 확인 링크 알림톡`,
      payload: {
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
        studentCount: targets.length,
        sentStudents,
        sentRecipients,
        failedCount: failed.length,
        resend,
      },
    });

    return Response.json({
      ok: failed.length === 0,
      mode: 'send',
      cohortId: cohort?.id || null,
      cohortName: cohort?.name || '',
      studentCount: targets.length,
      sentStudents,
      sentRecipients,
      failed,
      skipped,
      results,
      message: failed.length
        ? `${sentStudents}명 발송 접수, ${failed.length}명 실패`
        : `${sentStudents}명(보호자 ${sentRecipients}명) 발송을 접수했습니다.`,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
