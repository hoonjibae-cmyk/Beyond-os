// Beyond OS v41-165
// 기수별 좌석 배치 초안 API입니다.
//
//   GET  : 기수 초안 + 현재 실제 좌석 + 검증 결과
//   POST : set_seat / clear_seat / copy_live(현재 배치 복사) / carry_over(이어 다니는 학생 자리 유지)
//          / clear_all / apply(실제 좌석에 반영)
//
// 핵심 규칙
//   [적용]을 누르기 전까지는 students.default_seat_no 와 seats 를 건드리지 않습니다.
//   그래서 1기가 돌아가는 중에도 2기 배치를 마음대로 짜 둘 수 있습니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { normalizeCohort } from '../../../lib/cohorts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SQL_HINT = 'beyond-os-supabase-cohort-seat-plans-v41-165.sql 실행 여부를 확인하세요.';

function toSeatNo(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function loadCohort(supabase, cohortId) {
  if (!cohortId) return null;
  const { data } = await supabase.from('cohorts').select('*').eq('id', cohortId).maybeSingle();
  return data ? normalizeCohort(data) : null;
}

async function loadPlanRows(supabase, cohortId) {
  const { data, error } = await supabase
    .from('cohort_seat_plans')
    .select('*, students(id, name, school, grade, status, default_seat_no)')
    .eq('cohort_id', cohortId)
    .order('seat_no', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * 초안이 실제로 적용 가능한 상태인지 봅니다.
 * 적용 버튼을 누르기 전에 화면에서 미리 알려주기 위한 것입니다.
 */
function buildWarnings({ planRows, rosterIds, seatNos }) {
  const warnings = [];
  const assigned = planRows.filter((row) => row.student_id);

  for (const row of planRows) {
    if (!seatNos.includes(Number(row.seat_no))) {
      warnings.push({ level: 'high', message: `${row.seat_no}번은 좌석 배치도에 없는 번호입니다.` });
    }
    if (row.student_id && row.students?.status === 'inactive') {
      warnings.push({ level: 'high', message: `${row.students?.name || '학생'}은(는) 비활성 학생입니다. (${row.seat_no}번)` });
    }
    if (row.student_id && rosterIds.size && !rosterIds.has(String(row.student_id))) {
      warnings.push({
        level: 'medium',
        message: `${row.students?.name || '학생'}은(는) 이 기수 명단에 없습니다. (${row.seat_no}번)`,
      });
    }
  }

  // 명단에는 있는데 자리가 없는 학생
  if (rosterIds.size) {
    const seated = new Set(assigned.map((row) => String(row.student_id)));
    const missing = [...rosterIds].filter((id) => !seated.has(id));
    if (missing.length) {
      warnings.push({ level: 'medium', message: `명단에 있으나 자리를 배정하지 않은 학생 ${missing.length}명이 있습니다.` });
    }
  }

  return warnings;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const cohortId = String(searchParams.get('cohortId') || '').trim();
    if (!cohortId) return Response.json({ error: 'cohortId is required' }, { status: 400 });

    const cohort = await loadCohort(supabase, cohortId);
    if (!cohort) return Response.json({ error: '기수를 찾지 못했습니다.' }, { status: 404 });

    const [planRows, seatsResult, rosterResult, studentsResult] = await Promise.all([
      loadPlanRows(supabase, cohortId),
      supabase.from('seats').select('seat_no, current_student_id, is_active').order('seat_no', { ascending: true }),
      supabase.from('cohort_students').select('student_id').eq('cohort_id', cohortId).eq('is_active', true),
      supabase.from('students').select('id, name, school, grade, status, default_seat_no').order('name', { ascending: true }),
    ]);

    const seats = seatsResult.data || [];
    const seatNos = seats.map((seat) => Number(seat.seat_no));
    const rosterIds = new Set((rosterResult.data || []).map((row) => String(row.student_id)));
    const students = studentsResult.data || [];
    const studentById = Object.fromEntries(students.map((item) => [String(item.id), item]));

    // 지금 실제로 앉아 있는 배치 (참고용으로 함께 보여줍니다)
    const liveBySeat = {};
    for (const seat of seats) {
      const id = seat.current_student_id ? String(seat.current_student_id) : '';
      liveBySeat[Number(seat.seat_no)] = id
        ? { studentId: id, name: studentById[id]?.name || '학생' }
        : null;
    }

    return Response.json({
      ok: true,
      cohort,
      seats: seats.map((seat) => ({ seatNo: Number(seat.seat_no), isActive: seat.is_active !== false })),
      plan: planRows.map((row) => ({
        seatNo: Number(row.seat_no),
        studentId: row.student_id ? String(row.student_id) : '',
        studentName: row.students?.name || '',
        studentInfo: [row.students?.school, row.students?.grade].filter(Boolean).join(' '),
        status: row.students?.status || '',
        memo: row.memo || '',
      })),
      liveBySeat,
      rosterIds: [...rosterIds],
      students: students.filter((item) => item.status !== 'inactive'),
      warnings: buildWarnings({ planRows, rosterIds, seatNos }),
      assignedCount: planRows.filter((row) => row.student_id).length,
      rosterCount: rosterIds.size,
    });
  } catch (error) {
    return Response.json({ error: `${error.message || '좌석 초안 조회 실패'} / ${SQL_HINT}` }, { status: 500 });
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
    const actorName = actor?.displayName || '관리자';

    const cohortId = String(body.cohortId || '').trim();
    if (!cohortId) return Response.json({ error: 'cohortId is required' }, { status: 400 });
    const cohort = await loadCohort(supabase, cohortId);
    if (!cohort) return Response.json({ error: '기수를 찾지 못했습니다.' }, { status: 404 });

    // ── 좌석 한 칸 지정 ──────────────────────────────────────
    if (action === 'set_seat') {
      const seatNo = toSeatNo(body.seatNo);
      if (!seatNo) return Response.json({ error: '좌석 번호가 올바르지 않습니다.' }, { status: 400 });
      const studentId = String(body.studentId || '').trim();

      // 같은 기수에서 그 학생이 다른 자리에 이미 있으면 먼저 비웁니다.
      if (studentId) {
        await supabase
          .from('cohort_seat_plans')
          .delete()
          .eq('cohort_id', cohortId)
          .eq('student_id', studentId);
      }

      const { error } = await supabase
        .from('cohort_seat_plans')
        .upsert({
          cohort_id: cohortId,
          seat_no: seatNo,
          student_id: studentId || null,
          memo: String(body.memo || '').slice(0, 200) || null,
          created_by: actorName,
        }, { onConflict: 'cohort_id,seat_no' });
      if (error) throw error;

      return Response.json({ ok: true, message: studentId ? '자리를 지정했습니다.' : '자리를 비웠습니다.' });
    }

    if (action === 'clear_seat') {
      const seatNo = toSeatNo(body.seatNo);
      if (!seatNo) return Response.json({ error: '좌석 번호가 올바르지 않습니다.' }, { status: 400 });
      const { error } = await supabase
        .from('cohort_seat_plans').delete().eq('cohort_id', cohortId).eq('seat_no', seatNo);
      if (error) throw error;
      return Response.json({ ok: true, message: '자리를 비웠습니다.' });
    }

    if (action === 'clear_all') {
      const { error } = await supabase.from('cohort_seat_plans').delete().eq('cohort_id', cohortId);
      if (error) throw error;
      return Response.json({ ok: true, message: '초안을 모두 지웠습니다.' });
    }

    // ── 현재 배치를 그대로 복사 ──────────────────────────────
    // "대부분 1기 자리 그대로" 쓰는 경우의 출발점입니다.
    if (action === 'copy_live') {
      const { data: seats } = await supabase
        .from('seats').select('seat_no, current_student_id').order('seat_no', { ascending: true });
      const rows = (seats || [])
        .filter((seat) => seat.current_student_id)
        .map((seat) => ({
          cohort_id: cohortId,
          seat_no: Number(seat.seat_no),
          student_id: seat.current_student_id,
          created_by: actorName,
        }));

      await supabase.from('cohort_seat_plans').delete().eq('cohort_id', cohortId);
      if (rows.length) {
        const { error } = await supabase.from('cohort_seat_plans').insert(rows);
        if (error) throw error;
      }
      return Response.json({ ok: true, copied: rows.length, message: `현재 좌석 배치 ${rows.length}자리를 초안으로 가져왔습니다.` });
    }

    // ── 이어 다니는 학생만 기존 자리 유지 ────────────────────
    // 이 기수 명단에 있는 학생 중 지금 자리가 있는 사람만 그 자리로 채웁니다.
    if (action === 'carry_over') {
      const [{ data: roster }, { data: seats }] = await Promise.all([
        supabase.from('cohort_students').select('student_id').eq('cohort_id', cohortId).eq('is_active', true),
        supabase.from('seats').select('seat_no, current_student_id').order('seat_no', { ascending: true }),
      ]);
      const rosterIds = new Set((roster || []).map((row) => String(row.student_id)));
      const rows = (seats || [])
        .filter((seat) => seat.current_student_id && rosterIds.has(String(seat.current_student_id)))
        .map((seat) => ({
          cohort_id: cohortId,
          seat_no: Number(seat.seat_no),
          student_id: seat.current_student_id,
          created_by: actorName,
        }));

      await supabase.from('cohort_seat_plans').delete().eq('cohort_id', cohortId);
      if (rows.length) {
        const { error } = await supabase.from('cohort_seat_plans').insert(rows);
        if (error) throw error;
      }
      return Response.json({
        ok: true,
        copied: rows.length,
        message: `이번 기수 명단에 있으면서 지금 자리가 있는 ${rows.length}명의 자리를 그대로 가져왔습니다.`
          + `${rosterIds.size > rows.length ? ` 나머지 ${rosterIds.size - rows.length}명은 직접 배정하세요.` : ''}`,
      });
    }

    // ── 실제 좌석에 반영 ─────────────────────────────────────
    // 기수 전환일에 한 번 누릅니다. 이때 비로소 1기 배치가 바뀝니다.
    if (action === 'apply') {
      const planRows = await loadPlanRows(supabase, cohortId);
      const assigned = planRows.filter((row) => row.student_id);
      if (!assigned.length) {
        return Response.json({ error: '초안에 배정된 자리가 없습니다.' }, { status: 400 });
      }

      // 비활성 학생이 섞여 있으면 막습니다. 되돌리기 번거로운 작업이라 미리 걸러냅니다.
      const inactive = assigned.filter((row) => row.students?.status === 'inactive');
      if (inactive.length) {
        return Response.json({
          error: `비활성 학생이 초안에 있습니다: ${inactive.map((row) => row.students?.name || row.student_id).join(', ')}`,
        }, { status: 400 });
      }

      const planStudentIds = assigned.map((row) => String(row.student_id));
      const planBySeat = new Map(assigned.map((row) => [Number(row.seat_no), String(row.student_id)]));

      // 1) 이번 배치에 없는 학생의 기본 좌석을 비웁니다.
      //    (2기를 안 듣는 학생이 자리를 붙들고 있으면 새 배치와 충돌합니다)
      const { data: allStudents } = await supabase
        .from('students').select('id, default_seat_no, status');
      const toClear = (allStudents || [])
        .filter((item) => item.default_seat_no !== null && item.default_seat_no !== undefined)
        .filter((item) => !planStudentIds.includes(String(item.id)))
        .map((item) => item.id);

      for (const id of toClear) {
        await supabase.from('students').update({ default_seat_no: null }).eq('id', id);
      }

      // 2) 좌석 테이블을 통째로 비웠다가 초안대로 채웁니다.
      await supabase.from('seats').update({ current_student_id: null }).not('seat_no', 'is', null);

      let applied = 0;
      const failed = [];
      for (const [seatNo, studentId] of planBySeat.entries()) {
        const { error: studentError } = await supabase
          .from('students').update({ default_seat_no: seatNo }).eq('id', studentId);
        const { error: seatError } = await supabase
          .from('seats').update({ current_student_id: studentId }).eq('seat_no', seatNo);
        if (studentError || seatError) {
          failed.push({ seatNo, studentId, error: (studentError || seatError)?.message });
        } else {
          applied += 1;
        }
      }

      await writeUserActionLog(supabase, request, {
        actionType: 'cohort_seat_plan.apply',
        targetType: 'cohort',
        targetId: cohortId,
        targetName: cohort.name,
        payload: { applied, cleared: toClear.length, failed: failed.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        applied,
        cleared: toClear.length,
        failed,
        message: `${cohort.name} 좌석 배치를 실제로 반영했습니다. ${applied}자리 배정`
          + `${toClear.length ? ` · 이번 배치에 없는 ${toClear.length}명의 기본 좌석 해제` : ''}`
          + `${failed.length ? ` · 실패 ${failed.length}건` : ''}`,
      });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: `${error.message || '좌석 초안 처리 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}
