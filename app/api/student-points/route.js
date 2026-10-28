import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { buildBulkPointRows, formatBulkPointMessage } from '../../../lib/pointQuickPresets';
import { getKstDateString } from '../../../lib/date';
import { getPointAutoRules } from '../../../lib/pointAutoRulesServer';
import { matchesPenaltyNoticeKeyword } from '../../../lib/pointAutoRules';
import { sendPointNotification, isPenaltyEventTemplateConfigured } from '../../../lib/pointNotifications';
import { getCohortIdFromRequest, loadCohortRange } from '../../../lib/cohortScope';
import { resolvePenaltyStages } from '../../../lib/studentPointCycle';
import { buildPenaltyReason } from '../../../lib/penaltyCategories';
import { loadPointTotals } from '../../../lib/pointTotals';
import { sendPointSlackNotice, sendPointSlackBatch } from '../../../lib/slackNotify';

// v41-280: 카테고리·상세 칸이 아직 없는 DB(SQL 실행 전)에서는 그 칸을 빼고 다시 넣습니다.
function isMissingPointColumn(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('category') || message.includes('reason_detail') || message.includes('schema cache');
}

async function insertPointRow(supabase, row) {
  const first = await supabase.from('student_points').insert(row).select().single();
  if (!first.error) return { data: first.data, columnsMissing: false };
  if (!isMissingPointColumn(first.error) || (row.category === undefined && row.reason_detail === undefined)) throw first.error;
  const { category, reason_detail, ...rest } = row;
  void category; void reason_detail;
  const second = await supabase.from('student_points').insert(rest).select().single();
  if (second.error) throw second.error;
  return { data: second.data, columnsMissing: true };
}

// v41-280: 상벌점 발생 슬랙 알림. 저장을 막지 않습니다.
async function notifySlackForPoint(supabase, request, { data, studentId, category, detail, actorName, isSystem = false }) {
  try {
    const [{ data: student }, range] = await Promise.all([
      supabase.from('students').select('name').eq('id', studentId).maybeSingle(),
      loadCohortRange(supabase, getCohortIdFromRequest(request), getKstDateString()).catch(() => null),
    ]);
    const totals = await loadPointTotals(supabase, studentId, range);
    return await sendPointSlackNotice({
      studentName: student?.name || '학생',
      pointType: data.point_type,
      points: data.points,
      category: category || data.reason,
      detail,
      reason: data.reason,
      totals,
      actorName,
      pointDate: data.point_date,
      isSystem,
    });
  } catch (error) {
    return { ok: false, message: error?.message || '슬랙 알림 오류' };
  }
}

// v41-277: 벌점 사유에 설정된 낱말(기본 'CCTV')이 들어가면 그 벌점을 보호자·학생에게 바로 알림톡으로 보냅니다.
//   - '벌점 부여 안내' 템플릿(SOLAPI_TEMPLATE_ID_POINT_PENALTY_EVENT)이 설정돼 있으면 그 템플릿으로 한 건 안내.
//   - 아직 승인·설정 전이면 승인된 '상벌점 누적 안내' 템플릿을 수시 안내 변수로 대신 보냅니다. (학생이 바로 알게 하는 것이 목적)
// 누적 합계는 보고 있는 기수 기간 안에서 셉니다. (기수를 못 찾으면 전체)
async function maybeSendPenaltyEventNotice(supabase, request, { point, studentId, actorName }) {
  try {
    const rules = await getPointAutoRules(supabase);
    if (rules.penaltyNoticeEnabled === false) return null;
    const matched = matchesPenaltyNoticeKeyword(point.reason, rules.penaltyNoticeKeywords);
    if (!matched) return null;

    const range = await loadCohortRange(supabase, getCohortIdFromRequest(request), getKstDateString()).catch(() => null);
    let query = supabase
      .from('student_points')
      .select('*')
      .eq('student_id', studentId)
      .eq('is_deleted', false)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (range?.start) query = query.gte('point_date', range.start);
    if (range?.end) query = query.lte('point_date', range.end);
    const { data: rows } = await query;
    const totals = summarize(rows || []);

    let result;
    let usedTemplate = 'event';
    if (isPenaltyEventTemplateConfigured()) {
      result = await sendPointNotification({
        kind: 'penalty_event',
        supabase,
        studentId,
        point,
        totals: { reward: totals.reward, penalty: totals.penalty, penaltyNet: totals.penalty - totals.reward },
        actorName,
      });
    } else {
      usedTemplate = 'cumulative';
      const state = resolvePenaltyStages(rows || [], [], { rewardRows: [], penaltyAlertThreshold: rules.penaltyAlertThreshold });
      result = await sendPointNotification({
        kind: 'penalty',
        manual: true,
        supabase,
        studentId,
        stage: Number(state.currentStage?.stage || 0),
        penaltyState: state,
        recentRows: rows || [],
        actorName,
      });
    }
    return { ...result, keyword: matched, usedTemplate };
  } catch (error) {
    return { ok: false, message: error?.message || '벌점 안내 알림톡 처리 중 오류', keyword: '' };
  }
}

export const dynamic = 'force-dynamic';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizePointType(value) {
  return value === 'penalty' ? 'penalty' : 'reward';
}

function summarize(rows = []) {
  const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  return {
    reward,
    penalty,
    net: reward - penalty,
    count: rows.length,
  };
}

async function attachStudents(supabase, rows = []) {
  const ids = [...new Set(rows.map((row) => String(row.student_id || '')).filter(Boolean))];
  const studentMap = {};
  if (ids.length) {
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, school, grade')
        .in('id', ids);
      for (const student of data || []) studentMap[String(student.id)] = student;
    } catch {
      // 학생 표시 정보 없이도 상벌점 기록은 반환합니다.
    }
  }
  return rows.map((row) => ({ ...row, student: studentMap[String(row.student_id)] || null }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const start = toDate(searchParams.get('start'));
    const end = toDate(searchParams.get('end'));
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200)));

    let query = supabase
      .from('student_points')
      .select('*')
      .eq('is_deleted', false)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (studentId) query = query.eq('student_id', String(studentId));
    if (start) query = query.gte('point_date', start);
    if (end) query = query.lte('point_date', end);

    const { data, error } = await query;
    if (error) throw error;

    const rows = await attachStudents(supabase, data || []);
    return Response.json({ rows, summary: summarize(rows) });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 조회 중 오류가 발생했습니다.'} / beyond-os-supabase-student-points-v40-90.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = body.action || 'create';
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';

    if (action === 'create') {
      const studentId = String(body.studentId || '').trim();
      const pointDate = toDate(body.pointDate) || new Date().toISOString().slice(0, 10);
      const pointType = normalizePointType(body.pointType);
      const points = Math.max(1, Math.round(Number(body.points || 1)));
      const memo = String(body.memo || '').trim();
      if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });

      // v41-280: 벌점은 카테고리 + 상세 사유로 받습니다. (예전 방식의 reason 만 와도 받습니다)
      let reason = String(body.reason || '').trim();
      let category = '';
      let detail = String(body.reasonDetail || '').trim().slice(0, 200);
      if (pointType === 'penalty' && body.penaltyCategory) {
        const built = buildPenaltyReason({ categoryKey: body.penaltyCategory, customLabel: body.penaltyCustomLabel, detail });
        if (!built.ok) return Response.json({ error: built.error }, { status: 400 });
        reason = built.reason;
        category = built.category;
        detail = built.detail;
      }
      if (!reason) return Response.json({ error: '상벌점 사유를 입력하세요.' }, { status: 400 });

      const { data, columnsMissing } = await insertPointRow(supabase, {
        student_id: studentId,
        point_date: pointDate,
        point_type: pointType,
        points,
        reason,
        memo: memo || null,
        created_by: actorName,
        is_deleted: false,
        category: category || null,
        reason_detail: detail || null,
      });

      await writeUserActionLog(supabase, request, {
        actionType: 'student_points.create',
        targetType: 'student_points',
        targetId: data.id,
        targetName: studentId,
        payload: { studentId, pointDate, pointType, points, reason, category, detail, memo, columnsMissing },
      });

      const slack = await notifySlackForPoint(supabase, request, { data, studentId, category, detail, actorName });

      // v41-277: 벌점 사유에 안내 낱말이 들어가면 바로 알림톡
      const notice = pointType === 'penalty'
        ? await maybeSendPenaltyEventNotice(supabase, request, { point: data, studentId, actorName })
        : null;
      const noticeNote = notice
        ? (notice.ok
          ? ` · 사유에 '${notice.keyword}'가 있어 보호자·학생 ${notice.recipients?.length || 0}명에게 ${notice.usedTemplate === 'cumulative' ? '누적 안내(벌점 부여 안내 템플릿 승인 전이라 대신)' : '벌점 부여 안내'} 알림톡을 보냈습니다.`
          : ` · 벌점 안내 알림톡은 보내지 못했습니다: ${notice.message || '원인 미상'}`)
        : '';

      const slackNote = slack?.skipped ? '' : slack?.ok ? ' · 슬랙 알림 발송' : ` · 슬랙 알림 실패(${slack?.message || '원인 미상'})`;
      const columnNote = columnsMissing ? ' · (카테고리 칸이 없어 사유 문구에만 남김 — beyond-os-supabase-student-points-category-v41-280.sql 실행 권장)' : '';

      return Response.json({
        ok: true,
        row: data,
        notice: notice ? { ok: Boolean(notice.ok), keyword: notice.keyword, usedTemplate: notice.usedTemplate || '', message: notice.message || '', recipientCount: notice.recipients?.length || 0 } : null,
        slack: slack ? { ok: Boolean(slack.ok), skipped: Boolean(slack.skipped), message: slack.message || '' } : null,
        message: `${pointType === 'reward' ? '상점' : '벌점'} ${points}점 기록 완료${noticeNote}${slackNote}${columnNote}`,
      });
    }

    // v41-269: 자주 주는 상점(모범태도/플래너) 또는 같은 내용을 여러 학생에게 한 번에 기록합니다.
    if (action === 'bulk_create') {
      const plan = buildBulkPointRows(body, { actorName, today: getKstDateString() });
      if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 });

      const { data, error } = await supabase
        .from('student_points')
        .insert(plan.rows)
        .select();
      if (error) throw error;

      const inserted = data || [];
      // v41-280.1: 여러 명이면 슬랙 메시지 하나에 학생별 한 줄씩 담습니다. (실패해도 저장은 끝난 상태)
      let slackSent = 0;
      try {
        const range = await loadCohortRange(supabase, getCohortIdFromRequest(request), getKstDateString()).catch(() => null);
        const ids = inserted.map((row) => String(row.student_id));
        const { data: nameRows } = ids.length ? await supabase.from('students').select('id, name').in('id', ids) : { data: [] };
        const nameById = Object.fromEntries((nameRows || []).map((row) => [String(row.id), row.name]));
        const items = [];
        for (const row of inserted) {
          const totals = await loadPointTotals(supabase, String(row.student_id), range);
          items.push({ studentName: nameById[String(row.student_id)] || '학생', category: row.reason, detail: '', points: row.points, totals });
        }
        const result = await sendPointSlackBatch({ pointType: plan.pointType, items, actorName, pointDate: plan.pointDate, subtitle: `자주 주는 상점 일괄 부여 · ${plan.reason}` });
        if (result?.ok) slackSent = items.length;
      } catch { /* 알림 실패는 저장을 막지 않습니다 */ }
      await writeUserActionLog(supabase, request, {
        actionType: 'student_points.bulk_create',
        targetType: 'student_points',
        targetId: inserted[0]?.id || null,
        targetName: `${plan.studentIds.length}명`,
        payload: {
          studentIds: plan.studentIds,
          pointDate: plan.pointDate,
          pointType: plan.pointType,
          points: plan.points,
          reason: plan.reason,
          memo: plan.memo,
          presetKey: body.presetKey || null,
          rowIds: inserted.map((row) => row.id),
        },
      });

      return Response.json({
        ok: true,
        rows: inserted,
        count: inserted.length,
        message: `${formatBulkPointMessage({ pointType: plan.pointType, points: plan.points, reason: plan.reason, count: inserted.length })}${slackSent ? ` · 슬랙 알림 1건(${slackSent}명)` : ''}`,
      });
    }

    if (action === 'delete') {
      const id = body.id;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data, error } = await supabase
        .from('student_points')
        .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: actorName })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'student_points.delete',
        targetType: 'student_points',
        targetId: data.id,
        targetName: data.student_id,
        payload: { id, studentId: data.student_id, pointType: data.point_type, points: data.points, reason: data.reason },
      });

      return Response.json({ ok: true, row: data, message: '상벌점 기록을 삭제했습니다.' });
    }

    return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 처리 중 오류가 발생했습니다.'} / beyond-os-supabase-student-points-v40-90.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}
