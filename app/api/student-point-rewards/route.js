// Beyond OS v41-137
// 상벌점 상품 지급(리셋) 처리 API입니다.
//
//   GET  : 학생별 현재 사이클 순점수와 "상품 지급 대상" 여부, 지급 이력을 돌려줍니다.
//   POST : action=grant(상품지급안내완료, 카운팅 리셋) / action=defer(미지급, 계속 누적)
//
// 상벌점 원본(student_points)은 어떤 경우에도 삭제하지 않습니다.
// 리셋은 "이 시점 이후만 센다"는 기준선을 남기는 방식으로 동작합니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { POINT_REWARD_THRESHOLD, resolvePointCycle, resolvePointCyclesByStudent } from '../../../lib/studentPointCycle';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_HINT = 'beyond-os-supabase-student-point-rewards-v41-137.sql 실행 여부를 확인하세요.';

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || message.includes('student_point_rewards') || message.includes('does not exist') || message.includes('schema cache');
}

async function loadPointRows(supabase, studentId) {
  let query = supabase
    .from('student_points')
    .select('id,student_id,point_date,point_type,points,reason,memo,created_by,created_at')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (studentId) query = query.eq('student_id', String(studentId));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadRewardRows(supabase, studentId) {
  try {
    let query = supabase
      .from('student_point_rewards')
      .select('*')
      .order('created_at', { ascending: true });
    if (studentId) query = query.eq('student_id', String(studentId));
    const { data, error } = await query;
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { rows: [], warning: `상품 지급 이력 테이블이 아직 없습니다. ${MISSING_TABLE_HINT}` };
    }
    throw error;
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = String(searchParams.get('studentId') || '').trim();

    const [pointRows, rewardResult] = await Promise.all([
      loadPointRows(supabase, studentId),
      loadRewardRows(supabase, studentId),
    ]);

    if (studentId) {
      const cycle = resolvePointCycle(pointRows, rewardResult.rows);
      return Response.json({
        ok: true,
        threshold: POINT_REWARD_THRESHOLD,
        studentId,
        cycle,
        warning: rewardResult.warning,
      });
    }

    const cycles = resolvePointCyclesByStudent(pointRows, rewardResult.rows);
    const studentIds = Object.keys(cycles);

    // 알림 배너에 이름을 함께 보여주기 위해 학생 표시 정보를 붙입니다.
    const studentMap = {};
    if (studentIds.length) {
      try {
        const { data } = await supabase
          .from('students')
          .select('id,name,school,grade,status')
          .in('id', studentIds);
        for (const student of data || []) studentMap[String(student.id)] = student;
      } catch {
        // 학생 표시 정보가 없어도 점수 계산 결과는 그대로 반환합니다.
      }
    }

    const eligible = studentIds
      .filter((id) => cycles[id]?.eligible)
      .filter((id) => studentMap[id]?.status !== 'inactive')
      .map((id) => ({
        studentId: id,
        student: studentMap[id] || null,
        name: studentMap[id]?.name || '학생',
        subtitle: [studentMap[id]?.school, studentMap[id]?.grade].filter(Boolean).join(' '),
        net: cycles[id].net,
        reward: cycles[id].reward,
        penalty: cycles[id].penalty,
        count: cycles[id].count,
        grantCount: cycles[id].grantCount,
        message: cycles[id].alertMessage,
      }))
      .sort((a, b) => b.net - a.net || String(a.name).localeCompare(String(b.name), 'ko'));

    return Response.json({
      ok: true,
      threshold: POINT_REWARD_THRESHOLD,
      cycles,
      eligible,
      warning: rewardResult.warning,
    });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 상품 지급 현황 조회 실패'} / ${MISSING_TABLE_HINT}`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const studentId = String(body.studentId || '').trim();
    const memo = String(body.memo || '').trim();

    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });
    if (!['grant', 'defer'].includes(action)) {
      return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';

    const [pointRows, rewardResult] = await Promise.all([
      loadPointRows(supabase, studentId),
      loadRewardRows(supabase, studentId),
    ]);
    if (rewardResult.warning) {
      return Response.json({ error: rewardResult.warning }, { status: 400 });
    }

    const cycle = resolvePointCycle(pointRows, rewardResult.rows);
    if (!cycle.eligible) {
      return Response.json({
        error: `현재 순점수는 ${cycle.net}점으로 상품 지급 대상이 아닙니다. (기준 ${cycle.threshold}점 초과)`,
      }, { status: 400 });
    }

    // 처리 당시 상벌점 내역을 스냅샷으로 남겨, 리셋 이후에도 이력에서 확인할 수 있게 합니다.
    const snapshot = {
      cycleStartAt: cycle.cycleStartAt,
      rows: cycle.cycleRows.map((row) => ({
        date: row.point_date,
        type: row.point_type,
        points: Number(row.points || 0),
        reason: row.reason || '',
      })),
    };

    const { data, error } = await supabase
      .from('student_point_rewards')
      .insert({
        student_id: studentId,
        action: action === 'grant' ? 'granted' : 'deferred',
        net_points: cycle.net,
        reward_points: cycle.reward,
        penalty_points: cycle.penalty,
        entry_count: cycle.count,
        threshold: cycle.threshold,
        cycle_start_at: cycle.cycleStartAt,
        snapshot,
        memo: memo || null,
        created_by: actorName,
      })
      .select()
      .single();

    if (error) throw error;

    const nextRewardRows = [...rewardResult.rows, data];
    const nextCycle = resolvePointCycle(pointRows, nextRewardRows);

    await writeUserActionLog(supabase, request, {
      actionType: action === 'grant' ? 'student_point_reward.grant' : 'student_point_reward.defer',
      targetType: 'student',
      targetId: studentId,
      payload: { net: cycle.net, reward: cycle.reward, penalty: cycle.penalty, memo },
    }).catch(() => {});

    return Response.json({
      ok: true,
      row: data,
      cycle: nextCycle,
      message: action === 'grant'
        ? `상품 지급 안내 완료로 기록하고 상벌점 카운팅을 리셋했습니다. (지급 당시 순점수 ${cycle.net}점)`
        : `미지급으로 기록했습니다. 순점수가 ${nextCycle.nextTargetNet}점이 되면 다시 알림이 표시됩니다.`,
    });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 상품 지급 처리 실패'} / ${MISSING_TABLE_HINT}`,
    }, { status: 500 });
  }
}
