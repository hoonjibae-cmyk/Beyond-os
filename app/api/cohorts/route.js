// Beyond OS v41-148
// 기수(코호트) 관리 API입니다.
//
//   GET  : 기수 목록 + 기수별 명단 + 정책 설정
//   POST : create / update / delete / set_settings / set_roster / carry_over
//
// 학생 원본(students)은 건드리지 않습니다. 기수별 "수강 명단"만 다룹니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import {
  loadCohortContext,
  saveCohortSettings,
  normalizeCohort,
  normalizeCohortSettings,
  sortCohorts,
  isUsableCohort,
  resolveDefaultCohort,
  findOverlappingCohorts,
} from '../../../lib/cohorts';

export const dynamic = 'force-dynamic';

const SQL_HINT = 'beyond-os-supabase-cohorts-v41-148.sql 실행 여부를 확인하세요.';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function uniqueIds(list = []) {
  return [...new Set((list || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const today = getKstDateString();
    const context = await loadCohortContext(supabase);

    // 명단 편집 화면에서 쓸 학생 목록(활성 우선)도 함께 내려줍니다.
    let students = [];
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, school, grade, status, default_seat_no, product_tier')
        .order('name', { ascending: true });
      students = data || [];
    } catch {
      students = [];
    }

    const rosters = {};
    for (const [cohortId, set] of Object.entries(context.rosterByCohort)) {
      rosters[cohortId] = [...set];
    }

    const cohortsWithCounts = context.cohorts.map((cohort) => ({
      ...cohort,
      studentCount: (rosters[cohort.id] || []).length,
      isCurrent: isUsableCohort(cohort) && cohort.startDate <= today && today <= cohort.endDate,
    }));

    return Response.json({
      ok: true,
      today,
      available: context.available,
      warning: context.warning,
      settings: context.settings,
      cohorts: cohortsWithCounts,
      rosters,
      students,
      defaultCohortId: resolveDefaultCohort(context.cohorts, context.settings, today)?.id || null,
    });
  } catch (error) {
    return Response.json({ error: `${error.message || '기수 조회 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';

    // ── 정책 설정 저장 ────────────────────────────────────────
    if (action === 'set_settings') {
      const settings = await saveCohortSettings(supabase, {
        ...(body.settings || {}),
      });
      return Response.json({
        ok: true,
        settings,
        message: settings.separateAcrossCohorts
          ? '기수별로 기록을 분리해서 집계합니다.'
          : '이전 기수부터 이어서 누적 집계합니다. (두 기수 연속 수강생 대상)',
      });
    }

    // ── 기수 생성 / 수정 ──────────────────────────────────────
    if (action === 'create' || action === 'update') {
      const name = String(body.name || '').trim();
      const startDate = toDate(body.startDate);
      const endDate = toDate(body.endDate);

      if (!name) return Response.json({ error: '기수 이름을 입력하세요.' }, { status: 400 });
      if (!startDate || !endDate) return Response.json({ error: '시작일과 종료일을 모두 입력하세요.' }, { status: 400 });
      if (startDate > endDate) return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });

      const payload = {
        name,
        start_date: startDate,
        end_date: endDate,
        memo: String(body.memo || '').trim() || null,
        sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        is_active: body.isActive !== false,
        updated_at: new Date().toISOString(),
      };

      let saved = null;
      if (action === 'create') {
        const { data, error } = await supabase
          .from('cohorts')
          .insert({ ...payload, created_by: actorName })
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });
        const { data, error } = await supabase
          .from('cohorts')
          .update(payload)
          .eq('id', body.id)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      }

      const context = await loadCohortContext(supabase);
      const overlaps = findOverlappingCohorts(normalizeCohort(saved), context.cohorts);

      await writeUserActionLog(supabase, request, {
        actionType: action === 'create' ? 'cohort.create' : 'cohort.update',
        targetType: 'cohort',
        targetId: saved.id,
        targetName: saved.name,
        payload: { startDate, endDate },
      }).catch(() => {});

      return Response.json({
        ok: true,
        cohort: normalizeCohort(saved),
        // 기간이 겹치면 집계가 두 기수에 중복으로 잡히므로 알려줍니다.
        warning: overlaps.length
          ? `기간이 겹치는 기수가 있습니다: ${overlaps.map((item) => item.name).join(', ')}. 같은 날짜가 두 기수에 모두 집계될 수 있습니다.`
          : '',
        message: action === 'create' ? '기수를 추가했습니다.' : '기수 정보를 저장했습니다.',
      });
    }

    // ── 기수 삭제 ─────────────────────────────────────────────
    if (action === 'delete') {
      if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 });
      const { error } = await supabase.from('cohorts').delete().eq('id', body.id);
      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'cohort.delete',
        targetType: 'cohort',
        targetId: body.id,
        payload: {},
      }).catch(() => {});

      return Response.json({
        ok: true,
        message: '기수를 삭제했습니다. 학생 정보와 출결 기록은 그대로 남아 있습니다.',
      });
    }

    // ── 명단 저장(전체 교체) ──────────────────────────────────
    // 화면에서 체크한 학생 목록을 그대로 이 기수의 명단으로 만듭니다.
    if (action === 'set_roster') {
      const cohortId = String(body.cohortId || '').trim();
      if (!cohortId) return Response.json({ error: 'cohortId is required' }, { status: 400 });
      const studentIds = uniqueIds(body.studentIds);

      const { data: existing, error: existingError } = await supabase
        .from('cohort_students')
        .select('id, student_id')
        .eq('cohort_id', cohortId);
      if (existingError) throw existingError;

      const existingIds = new Set((existing || []).map((row) => String(row.student_id)));
      const nextIds = new Set(studentIds);

      const toRemove = (existing || []).filter((row) => !nextIds.has(String(row.student_id))).map((row) => row.id);
      const toAdd = studentIds.filter((id) => !existingIds.has(id));

      if (toRemove.length) {
        const { error } = await supabase.from('cohort_students').delete().in('id', toRemove);
        if (error) throw error;
      }
      if (toAdd.length) {
        const { error } = await supabase.from('cohort_students').insert(
          toAdd.map((studentId) => ({
            cohort_id: cohortId,
            student_id: studentId,
            is_active: true,
            created_by: actorName,
          })),
        );
        if (error) throw error;
      }

      await writeUserActionLog(supabase, request, {
        actionType: 'cohort.roster_save',
        targetType: 'cohort',
        targetId: cohortId,
        payload: { total: studentIds.length, added: toAdd.length, removed: toRemove.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        total: studentIds.length,
        added: toAdd.length,
        removed: toRemove.length,
        message: `명단을 저장했습니다. 총 ${studentIds.length}명 (추가 ${toAdd.length} · 제외 ${toRemove.length})`,
      });
    }

    // ── 이전 기수 명단 이관 ───────────────────────────────────
    // 학생 정보는 그대로 두고 명단만 복사합니다. 이후 화면에서 미신청 학생을 빼면 됩니다.
    if (action === 'carry_over') {
      const cohortId = String(body.cohortId || '').trim();
      const fromCohortId = String(body.fromCohortId || '').trim();
      if (!cohortId || !fromCohortId) {
        return Response.json({ error: 'cohortId, fromCohortId are required' }, { status: 400 });
      }
      if (cohortId === fromCohortId) {
        return Response.json({ error: '같은 기수끼리는 이관할 수 없습니다.' }, { status: 400 });
      }

      const { data: sourceRows, error: sourceError } = await supabase
        .from('cohort_students')
        .select('student_id')
        .eq('cohort_id', fromCohortId)
        .eq('is_active', true);
      if (sourceError) throw sourceError;

      const { data: targetRows, error: targetError } = await supabase
        .from('cohort_students')
        .select('student_id')
        .eq('cohort_id', cohortId);
      if (targetError) throw targetError;

      const already = new Set((targetRows || []).map((row) => String(row.student_id)));
      const sourceIds = uniqueIds((sourceRows || []).map((row) => row.student_id));

      // 비활성 학생은 이관하지 않습니다. (퇴원생이 새 기수에 딸려오는 것 방지)
      let activeSet = new Set(sourceIds);
      try {
        const { data: activeStudents } = await supabase
          .from('students')
          .select('id')
          .in('id', sourceIds)
          .eq('status', 'active');
        activeSet = new Set((activeStudents || []).map((row) => String(row.id)));
      } catch {
        // 학생 상태를 못 읽으면 원본 명단을 그대로 씁니다.
      }

      const toAdd = sourceIds.filter((id) => !already.has(id) && activeSet.has(id));
      if (toAdd.length) {
        const { error } = await supabase.from('cohort_students').insert(
          toAdd.map((studentId) => ({
            cohort_id: cohortId,
            student_id: studentId,
            is_active: true,
            created_by: actorName,
          })),
        );
        if (error) throw error;
      }

      await writeUserActionLog(supabase, request, {
        actionType: 'cohort.carry_over',
        targetType: 'cohort',
        targetId: cohortId,
        payload: { fromCohortId, added: toAdd.length },
      }).catch(() => {});

      const skipped = sourceIds.length - toAdd.length - 0;
      return Response.json({
        ok: true,
        added: toAdd.length,
        message: `이전 기수 명단에서 ${toAdd.length}명을 이관했습니다.${skipped > 0 ? ` (이미 있거나 비활성인 ${skipped}명 제외)` : ''} 이번 기수를 신청하지 않은 학생은 명단에서 빼주세요.`,
      });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: `${error.message || '기수 저장 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}
