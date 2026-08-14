// Beyond OS v41-164
// 랭킹보드 닉네임 자동 생성 API입니다.
//
//   GET  : 현재 쓰고 있는 닉네임과 남은 후보 수
//   POST : suggest(한 명 제안) / assign_bulk(닉네임 없는 학생에게 일괄 배정)
//
// 닉네임은 이미 쓰는 이름과 겹치면 안 되므로, 후보를 고르는 일은 항상 서버에서 합니다.
// 화면에서 고르면 두 관리자가 동시에 작업할 때 같은 이름이 두 번 나갈 수 있습니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import {
  NICKNAME_POOL,
  generateNickname,
  generateNicknamesForStudents,
  getAvailableNicknames,
  normalizeNickname,
} from '../../../lib/studentNickname';

export const dynamic = 'force-dynamic';

// 현재 쓰고 있는 닉네임을 모읍니다. (비활성 학생 것도 포함 — 재등록 시 겹치면 곤란합니다)
async function loadTakenNicknames(supabase) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, nickname, status')
    .not('nickname', 'is', null);
  if (error) throw error;
  const rows = data || [];
  return {
    rows,
    taken: rows.map((row) => row.nickname).filter(Boolean),
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { rows, taken } = await loadTakenNicknames(supabase);
    const available = getAvailableNicknames(taken);

    return Response.json({
      ok: true,
      poolSize: NICKNAME_POOL.length,
      usedCount: taken.length,
      remaining: available.length,
      taken: rows.map((row) => ({ id: row.id, name: row.name, nickname: row.nickname })),
    });
  } catch (error) {
    return Response.json({ error: error.message || '닉네임 현황 조회 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || 'suggest').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';

    const { rows, taken } = await loadTakenNicknames(supabase);

    // ── 한 명 제안 ([랜덤 생성] / [다시 생성]) ────────────────
    // 저장하지 않고 후보만 돌려줍니다. 관리자가 [확정]을 눌러야 반영됩니다.
    if (action === 'suggest') {
      const studentId = String(body.studentId || '').trim();
      // 지금 편집 중인 학생이 이미 갖고 있는 닉네임은 "겹침"이 아니므로 후보에서 빼지 않습니다.
      const selfNickname = studentId
        ? rows.find((row) => String(row.id) === studentId)?.nickname || ''
        : '';
      const takenExceptSelf = taken.filter((item) => normalizeNickname(item) !== normalizeNickname(selfNickname));

      // [다시 생성]에서 방금 본 후보가 또 나오지 않도록 제외합니다.
      const exclude = Array.isArray(body.exclude) ? body.exclude : [];
      const result = generateNickname(takenExceptSelf, { exclude });
      if (!result.ok) return Response.json({ error: result.error }, { status: 409 });

      return Response.json({
        ok: true,
        nickname: result.nickname,
        remaining: result.remaining,
      });
    }

    // ── 닉네임 없는 학생에게 일괄 배정 ────────────────────────
    if (action === 'assign_bulk') {
      const requestedIds = Array.isArray(body.studentIds)
        ? body.studentIds.map(String).filter(Boolean)
        : null;

      let query = supabase.from('students').select('id, name, nickname, status');
      if (requestedIds?.length) query = query.in('id', requestedIds);
      const { data: allStudents, error: studentsError } = await query;
      if (studentsError) throw studentsError;

      // 이미 닉네임이 있는 학생은 건드리지 않습니다. (관리자가 정한 이름을 덮어쓰면 안 됩니다)
      const targets = (allStudents || [])
        .filter((row) => row.status !== 'inactive')
        .filter((row) => !String(row.nickname || '').trim());

      if (!targets.length) {
        return Response.json({
          ok: true,
          assigned: 0,
          assignments: [],
          message: '닉네임이 비어 있는 활성 학생이 없습니다.',
        });
      }

      const { assignments, unassigned, remaining } = generateNicknamesForStudents(targets, taken);

      // 미리보기만 요청한 경우에는 저장하지 않습니다.
      if (body.preview) {
        return Response.json({
          ok: true,
          preview: true,
          assignments,
          unassignedCount: unassigned.length,
          remaining,
          message: `${assignments.length}명에게 배정할 닉네임을 만들었습니다. 확정하면 저장됩니다.`,
        });
      }

      let saved = 0;
      const failed = [];
      for (const item of assignments) {
        const { error } = await supabase
          .from('students')
          .update({ nickname: item.nickname })
          .eq('id', item.id);
        if (error) failed.push({ ...item, error: error.message });
        else saved += 1;
      }

      await writeUserActionLog(supabase, request, {
        actionType: 'student.nickname_bulk_assign',
        targetType: 'student',
        targetName: `${saved}명`,
        payload: { assigned: saved, failed: failed.length, unassigned: unassigned.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        assigned: saved,
        assignments,
        failed,
        unassignedCount: unassigned.length,
        remaining,
        message: `${saved}명에게 닉네임을 배정했습니다.`
          + `${unassigned.length ? ` 남은 후보가 부족해 ${unassigned.length}명은 배정하지 못했습니다.` : ''}`
          + `${failed.length ? ` (저장 실패 ${failed.length}명)` : ''}`,
      });
    }

    // ── 한 명 확정 저장 ───────────────────────────────────────
    if (action === 'confirm') {
      const studentId = String(body.studentId || '').trim();
      const nickname = String(body.nickname || '').trim();
      if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });
      if (!nickname) return Response.json({ error: '닉네임이 비어 있습니다.' }, { status: 400 });

      // 다른 학생이 쓰고 있는 이름인지 마지막으로 한 번 더 확인합니다.
      const conflict = rows.find((row) => String(row.id) !== studentId
        && normalizeNickname(row.nickname) === normalizeNickname(nickname));
      if (conflict) {
        return Response.json({
          error: `이미 ${conflict.name} 학생이 쓰고 있는 닉네임입니다. 다시 생성해 주세요.`,
        }, { status: 409 });
      }

      const { data, error } = await supabase
        .from('students')
        .update({ nickname })
        .eq('id', studentId)
        .select('id, name, nickname')
        .single();
      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'student.nickname_confirm',
        targetType: 'student',
        targetId: studentId,
        targetName: data?.name || '',
        payload: { nickname },
      }).catch(() => {});

      return Response.json({
        ok: true,
        student: data,
        message: `${data?.name || '학생'} 닉네임을 "${nickname}"으로 확정했습니다.`,
      });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || '닉네임 생성 실패' }, { status: 500 });
  }
}
