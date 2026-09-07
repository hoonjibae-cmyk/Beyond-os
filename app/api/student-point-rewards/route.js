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
import { sendPointNotification } from '../../../lib/pointNotifications';
import { getCohortIdFromRequest, loadCohortRange } from '../../../lib/cohortScope';
import { getPointAutoRules } from '../../../lib/pointAutoRulesServer';
import { AUTO_TABLE_HINT } from '../../../lib/pointAutoRules';
import { getKstDateString } from '../../../lib/date';
import {
  PENALTY_STAGES,
  resolvePointCycle,
  resolvePointCyclesByStudent,
  resolvePenaltyStages,
  resolvePenaltyStagesByStudent,
  getPenaltyStageDef,
} from '../../../lib/studentPointCycle';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_HINT = 'beyond-os-supabase-student-point-rewards-v41-137.sql 실행 여부를 확인하세요.';
const PENALTY_TABLE_HINT = 'beyond-os-supabase-student-penalty-actions-v41-156.sql 실행 여부를 확인하세요.';

// v41-236: 상벌점은 기수별로 따로 셉니다.
//
// 지금까지는 학생의 모든 기록을 합산해서, 2기 학생 화면에 1기 벌점이 그대로
// 얹혀 있었습니다. 기수가 바뀌면 상벌점도 처음부터 시작해야 합니다.
//
// 기수를 못 찾으면 null 을 돌려주고 예전처럼 전체를 셉니다.
// (기수를 아직 만들지 않은 환경에서 화면이 비지 않게)
//
// v41-241: 같은 계산을 주간 배치에서도 써서 lib/cohortScope 로 옮겼습니다.
function resolvePointCohortRange(supabase, request) {
  return loadCohortRange(supabase, getCohortIdFromRequest(request), getKstDateString());
}

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || message.includes('student_point_rewards') || message.includes('does not exist') || message.includes('schema cache');
}

// v41-156: 벌점 단계 조치 기록. 테이블이 없어도 상품 지급 기능은 그대로 동작해야 합니다.
async function loadPenaltyActionRows(supabase, studentId, range = null) {
  try {
    let query = supabase
      .from('student_penalty_actions')
      .select('*')
      .order('created_at', { ascending: true });
    if (studentId) query = query.eq('student_id', String(studentId));
    // 조치 기록에는 날짜 컬럼이 없어 생성 시각으로 자릅니다.
    if (range) query = query.gte('created_at', `${range.start}T00:00:00+09:00`).lte('created_at', `${range.end}T23:59:59+09:00`);
    const { data, error } = await query;
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.code === '42P01' || message.includes('student_penalty_actions') || message.includes('does not exist') || message.includes('schema cache')) {
      return { rows: [], warning: `벌점 단계 조치 기록 테이블이 아직 없습니다. ${PENALTY_TABLE_HINT}` };
    }
    throw error;
  }
}

async function loadPointRows(supabase, studentId, range = null) {
  let query = supabase
    .from('student_points')
    .select('id,student_id,point_date,point_type,points,reason,memo,created_by,created_at')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (studentId) query = query.eq('student_id', String(studentId));
  if (range) query = query.gte('point_date', range.start).lte('point_date', range.end);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadRewardRows(supabase, studentId, range = null) {
  try {
    let query = supabase
      .from('student_point_rewards')
      .select('*')
      .order('created_at', { ascending: true });
    if (studentId) query = query.eq('student_id', String(studentId));
    if (range) query = query.gte('created_at', `${range.start}T00:00:00+09:00`).lte('created_at', `${range.end}T23:59:59+09:00`);
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

// ── v41-241: 상품 지급 대상은 "매주 월요일 스캔 결과"로 봅니다 ─────────
//
// 예전에는 이 화면을 열 때마다 그 순간의 순점수로 판정했습니다. 그래서 주중에
// 상점 한 건만 넣어도 명단이 바로 늘었다 줄었다 했습니다. 이제 월요일 배치가
// 남긴 스냅샷을 그대로 보여 줍니다. (/api/cron/weekly-points)

async function loadLatestScan(supabase, studentId = '') {
  try {
    const { data: latest, error: latestError } = await supabase
      .from('student_point_weekly_scans')
      .select('scan_date')
      .order('scan_date', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const scanDate = String(latest?.[0]?.scan_date || '').slice(0, 10);
    if (!scanDate) return { scanDate: '', rows: [], warning: '' };

    let query = supabase
      .from('student_point_weekly_scans')
      .select('*')
      .eq('scan_date', scanDate);
    if (studentId) query = query.eq('student_id', String(studentId));
    const { data, error } = await query;
    if (error) throw error;
    return { scanDate, rows: data || [], warning: '' };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { scanDate: '', rows: [], warning: `주간 스캔 표가 아직 없습니다. ${AUTO_TABLE_HINT}` };
    }
    return { scanDate: '', rows: [], warning: error?.message || '주간 스캔 결과를 읽지 못했습니다.' };
  }
}

async function loadAutoAwards(supabase, studentId, range = null, limit = 200) {
  try {
    let query = supabase
      .from('student_point_auto_awards')
      .select('*')
      .order('week_start', { ascending: false })
      .order('points', { ascending: false })
      .limit(limit);
    if (studentId) query = query.eq('student_id', String(studentId));
    if (range) query = query.gte('week_end', range.start).lte('week_start', range.end);
    const { data, error } = await query;
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { rows: [], warning: `자동 상점 표가 아직 없습니다. ${AUTO_TABLE_HINT}` };
    }
    return { rows: [], warning: error?.message || '자동 상점 내역을 읽지 못했습니다.' };
  }
}

// v41-241: 명단에서 처리한 건에 도장을 찍습니다.
// 이 표가 없거나 스캔 기록이 없어도 지급 처리 자체는 막지 않습니다.
async function markScanHandled(supabase, studentId, action) {
  try {
    const { data, error } = await supabase
      .from('student_point_weekly_scans')
      .select('id')
      .eq('student_id', String(studentId))
      .order('scan_date', { ascending: false })
      .limit(1);
    if (error) throw error;
    const id = data?.[0]?.id;
    if (!id) return;
    await supabase
      .from('student_point_weekly_scans')
      .update({ handled_at: new Date().toISOString(), handled_action: action })
      .eq('id', id);
  } catch {
    // 명단 표시는 다음 스캔에서 정리됩니다. 지급 처리 결과를 되돌리지는 않습니다.
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = String(searchParams.get('studentId') || '').trim();

    // v41-236: 지금 보고 있는 기수 기간의 기록만 셉니다.
    const cohortRange = await resolvePointCohortRange(supabase, request);
    // v41-241: 지급 기준 순점수는 상벌점 관리 화면에서 설정합니다. (기본 15점)
    const autoRules = await getPointAutoRules(supabase);
    const threshold = autoRules.rewardThreshold;
    const [pointRows, rewardResult, penaltyResult] = await Promise.all([
      loadPointRows(supabase, studentId, cohortRange),
      loadRewardRows(supabase, studentId, cohortRange),
      loadPenaltyActionRows(supabase, studentId, cohortRange),
    ]);

    if (studentId) {
      const cycle = resolvePointCycle(pointRows, rewardResult.rows, { threshold });
      const penalty = resolvePenaltyStages(pointRows, penaltyResult.rows, { rewardRows: rewardResult.rows });
      const autoAwardResult = await loadAutoAwards(supabase, studentId, cohortRange, 60);
      return Response.json({
        ok: true,
        threshold,
        autoRules,
        penaltyStages: PENALTY_STAGES,
        studentId,
        cycle,
        penalty,
        autoAwards: autoAwardResult.rows,
        warning: [rewardResult.warning, penaltyResult.warning, autoAwardResult.warning].filter(Boolean).join(' / '),
      });
    }

    const cycles = resolvePointCyclesByStudent(pointRows, rewardResult.rows, { threshold });
    const penaltyByStudent = resolvePenaltyStagesByStudent(pointRows, penaltyResult.rows, { rewardRows: rewardResult.rows });
    const studentIds = [...new Set([...Object.keys(cycles), ...Object.keys(penaltyByStudent)])];

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

    // v41-241: 상품 지급 대상 명단은 월요일 스캔 결과에서 가져옵니다.
    //
    // 아직 한 번도 스캔하지 않았다면(배포 직후, 첫 월요일 전) 예전처럼 실시간으로
    // 판정해 명단이 비어 보이지 않게 합니다. scanFallback 으로 화면에 알립니다.
    const scanResult = await loadLatestScan(supabase);
    const scanByStudent = {};
    for (const row of scanResult.rows) scanByStudent[String(row.student_id)] = row;
    const scanFallback = !scanResult.scanDate;

    const buildEligibleRow = (id, extra = {}) => ({
      studentId: id,
      student: studentMap[id] || null,
      name: studentMap[id]?.name || '학생',
      subtitle: [studentMap[id]?.school, studentMap[id]?.grade].filter(Boolean).join(' '),
      net: cycles[id]?.net ?? 0,
      reward: cycles[id]?.reward ?? 0,
      penalty: cycles[id]?.penalty ?? 0,
      count: cycles[id]?.count ?? 0,
      grantCount: cycles[id]?.grantCount ?? 0,
      message: cycles[id]?.alertMessage || `상벌점 누적 ${threshold}점 초과하여 상품 지급 대상입니다`,
      ...extra,
    });

    const eligible = (scanFallback
      ? studentIds
        .filter((id) => cycles[id]?.eligible)
        .map((id) => buildEligibleRow(id, { scanDate: '', streakWeeks: 1, scanNet: cycles[id].net, studyMinutes: 0, autoPoints: 0 }))
      : Object.values(scanByStudent)
        // 이미 [알림톡 발송]/[미지급]으로 처리한 건은 명단에서 내립니다.
        // is_eligible 자체는 그대로 두어야 연속 주 수가 어긋나지 않습니다.
        .filter((row) => row.is_eligible && !row.handled_at)
        .map((row) => {
          const id = String(row.student_id);
          return buildEligibleRow(id, {
            scanDate: String(row.scan_date || '').slice(0, 10),
            scanNet: Number(row.net_points || 0),
            streakWeeks: Number(row.streak_weeks || 1),
            studyMinutes: Number(row.study_minutes || 0),
            autoPoints: Number(row.auto_points || 0),
            weekStart: String(row.week_start || '').slice(0, 10),
            weekEnd: String(row.week_end || '').slice(0, 10),
          });
        }))
      .filter((row) => studentMap[row.studentId]?.status !== 'inactive')
      // 연속 초과가 오래된 학생을 먼저 보여 줍니다. (별도 상품 대상이라 눈에 띄어야 합니다)
      .sort((a, b) => (b.streakWeeks || 0) - (a.streakWeeks || 0)
        || (b.scanNet ?? b.net) - (a.scanNet ?? a.net)
        || String(a.name).localeCompare(String(b.name), 'ko'));

    // v41-156: 누적 벌점이 단계(10/20/30)를 넘겼는데 아직 조치하지 않은 학생.
    // 심각한 단계(제적 > 면담 > 경고)가 먼저 오도록 정렬합니다.
    const penaltyAlerts = studentIds
      .filter((id) => penaltyByStudent[id]?.currentStage)
      .filter((id) => studentMap[id]?.status !== 'inactive')
      .map((id) => {
        const state = penaltyByStudent[id];
        return {
          studentId: id,
          student: studentMap[id] || null,
          name: studentMap[id]?.name || '학생',
          subtitle: [studentMap[id]?.school, studentMap[id]?.grade].filter(Boolean).join(' '),
          penaltyNet: state.penaltyNet,
          reward: state.reward,
          penalty: state.penalty,
          net: state.net,
          stage: state.currentStage.stage,
          stageKey: state.currentStage.key,
          stageLabel: state.currentStage.label,
          tone: state.currentStage.tone,
          actionHint: state.currentStage.action,
          deferred: state.currentStage.deferred,
          message: state.currentStage.message,
          pendingStages: state.pendingStages.map((item) => ({
            stage: item.stage, label: item.label, deferred: item.deferred,
          })),
        };
      })
      .sort((a, b) => b.stage - a.stage || b.penaltyNet - a.penaltyNet || String(a.name).localeCompare(String(b.name), 'ko'));

    const autoAwardResult = await loadAutoAwards(supabase, '', cohortRange, 300);

    return Response.json({
      ok: true,
      threshold,
      autoRules,
      penaltyStages: PENALTY_STAGES,
      cycles,
      eligible,
      // v41-241: 명단을 만든 시점. 화면에 "OO 기준"으로 함께 보여 줍니다.
      lastScanDate: scanResult.scanDate,
      lastScanWeek: scanResult.rows[0]
        ? { start: String(scanResult.rows[0].week_start || '').slice(0, 10), end: String(scanResult.rows[0].week_end || '').slice(0, 10) }
        : null,
      scanFallback,
      scannedCount: scanResult.rows.length,
      // v41-241: 시스템이 자동으로 준 상점 내역
      autoAwards: autoAwardResult.rows.map((row) => ({
        ...row,
        name: studentMap[String(row.student_id)]?.name || '',
      })),
      penaltyByStudent,
      penaltyAlerts,
      warning: [rewardResult.warning, penaltyResult.warning, scanResult.warning, autoAwardResult.warning].filter(Boolean).join(' / '),
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
    if (!['grant', 'defer', 'penalty_done', 'penalty_defer'].includes(action)) {
      return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';
    // v41-236: 저장·판정도 화면과 같은 기수 기간을 봐야 숫자가 어긋나지 않습니다.
    const cohortRange = await resolvePointCohortRange(supabase, request);

    // ── v41-156: 벌점 단계 조치 기록 ─────────────────────────
    if (action === 'penalty_done' || action === 'penalty_defer') {
      const stage = Number(body.stage || 0);
      const stageDef = getPenaltyStageDef(stage);
      if (!stageDef) {
        return Response.json({ error: `단계 값이 올바르지 않습니다: ${body.stage ?? '-'}` }, { status: 400 });
      }

      const [points, penaltyRows, rewardsForStage] = await Promise.all([
        loadPointRows(supabase, studentId, cohortRange),
        loadPenaltyActionRows(supabase, studentId, cohortRange),
        loadRewardRows(supabase, studentId, cohortRange),
      ]);
      if (penaltyRows.warning) {
        return Response.json({ error: penaltyRows.warning }, { status: 400 });
      }

      const state = resolvePenaltyStages(points, penaltyRows.rows, { rewardRows: rewardsForStage.rows });
      if (state.penaltyNet <= stage) {
        return Response.json({
          error: `현재 순벌점은 ${state.penaltyNet}점(벌 ${state.penalty} - 상 ${state.reward})으로 ${stage}점 단계 대상이 아닙니다. (${stage}점 초과부터)`,
        }, { status: 400 });
      }

      const { data, error } = await supabase
        .from('student_penalty_actions')
        .insert({
          student_id: studentId,
          stage,
          action: action === 'penalty_done' ? 'done' : 'deferred',
          penalty_points: state.penaltyNet,
          memo: memo || null,
          created_by: actorName,
        })
        .select()
        .single();
      if (error) throw error;

      const nextState = resolvePenaltyStages(points, [...penaltyRows.rows, data], { rewardRows: rewardsForStage.rows });

      // v41-161: [조치 완료]는 이제 실제로 학부모·학생에게 알림톡을 보냅니다.
      // 보류는 아직 안내하지 않은 상태이므로 보내지 않습니다.
      // 발송에 실패해도 조치 기록 자체는 이미 남았으므로 되돌리지 않고 결과만 알려줍니다.
      let notification = null;
      if (action === 'penalty_done' && body.notify !== false) {
        notification = await sendPointNotification({
          kind: 'penalty',
          supabase,
          studentId,
          stage,
          penaltyState: state,
          recentRows: points.slice().reverse(),
          actorName,
        });
      }

      await writeUserActionLog(supabase, request, {
        actionType: action === 'penalty_done' ? 'student_penalty.done' : 'student_penalty.defer',
        targetType: 'student',
        targetId: studentId,
        payload: {
          stage, stageLabel: stageDef.label, penaltyNet: state.penaltyNet,
          reward: state.reward, penalty: state.penalty, memo,
          notified: Boolean(notification?.ok),
        },
      }).catch(() => {});

      const notifyNote = notification
        ? (notification.ok
          ? ` 학부모·학생 ${notification.recipients?.length || 0}명에게 알림톡을 발송했습니다.`
          : ` 다만 알림톡 발송은 실패했습니다: ${notification.message || '원인 미상'}`)
        : '';

      return Response.json({
        ok: true,
        row: data,
        penalty: nextState,
        notification,
        message: action === 'penalty_done'
          ? `순벌점 ${stage}점 단계 — ${stageDef.label} 조치 완료로 기록했습니다. (당시 순벌점 ${state.penaltyNet}점 · 벌 ${state.penalty} / 상 ${state.reward})${notifyNote}`
          : `순벌점 ${stage}점 단계 — ${stageDef.label}을 보류로 기록했습니다. 알림은 목록에 계속 남습니다.`,
      });
    }

    const [pointRows, rewardResult] = await Promise.all([
      loadPointRows(supabase, studentId, cohortRange),
      loadRewardRows(supabase, studentId, cohortRange),
    ]);
    if (rewardResult.warning) {
      return Response.json({ error: rewardResult.warning }, { status: 400 });
    }

    const autoRules = await getPointAutoRules(supabase);
    const cycle = resolvePointCycle(pointRows, rewardResult.rows, { threshold: autoRules.rewardThreshold });

    // v41-241: 명단은 월요일 스캔 기준입니다.
    //
    // 스캔 이후에 벌점이 들어가 지금 순점수가 기준 아래로 내려갔더라도, 명단에 올라
    // 있는 학생은 지급 처리를 막지 않습니다. 화면에 보이는 버튼이 눌리지 않는 쪽이
    // 더 나쁜 상황입니다. 반대로 스캔에는 없지만 지금 기준을 넘었다면 그것도 허용합니다.
    const scanForStudent = await loadLatestScan(supabase, studentId);
    const scanEligible = scanForStudent.rows.some((row) => row.is_eligible);
    if (!cycle.eligible && !scanEligible) {
      return Response.json({
        error: `현재 순점수는 ${cycle.net}점으로 상품 지급 대상이 아닙니다. (기준 ${cycle.threshold}점 초과 · 매주 월요일 스캔)`,
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

    await markScanHandled(supabase, studentId, action === 'grant' ? 'granted' : 'deferred');

    const nextRewardRows = [...rewardResult.rows, data];
    const nextCycle = resolvePointCycle(pointRows, nextRewardRows, { threshold: autoRules.rewardThreshold });

    // v41-161: [상품지급안내완료]는 이제 실제로 학부모·학생에게 알림톡을 보냅니다.
    // 미지급(defer)은 아직 안내할 내용이 없으므로 보내지 않습니다.
    let notification = null;
    if (action === 'grant' && body.notify !== false) {
      notification = await sendPointNotification({
        kind: 'reward',
        supabase,
        studentId,
        cycle,
        recentRows: cycle.cycleRows.slice().reverse(),
        actorName,
        // v41-214: 지급 안내 문구는 승인받은 알림톡 템플릿의 고정 문구입니다.
        // 호출 쪽에서 바꿔 보내면 승인 내용과 달라져 발송이 막힙니다.
      });
    }

    await writeUserActionLog(supabase, request, {
      actionType: action === 'grant' ? 'student_point_reward.grant' : 'student_point_reward.defer',
      targetType: 'student',
      targetId: studentId,
      payload: { net: cycle.net, reward: cycle.reward, penalty: cycle.penalty, memo, notified: Boolean(notification?.ok) },
    }).catch(() => {});

    const notifyNote = notification
      ? (notification.ok
        ? ` 학부모·학생 ${notification.recipients?.length || 0}명에게 알림톡을 발송했습니다.`
        : ` 다만 알림톡 발송은 실패했습니다: ${notification.message || '원인 미상'}`)
      : '';

    return Response.json({
      ok: true,
      row: data,
      cycle: nextCycle,
      notification,
      message: action === 'grant'
        ? `상품 지급 안내 완료로 기록하고 상벌점 카운팅을 리셋했습니다. (지급 당시 순점수 ${cycle.net}점)${notifyNote}`
        : `미지급으로 기록했습니다. 순점수가 ${nextCycle.nextTargetNet}점이 되면 다시 알림이 표시됩니다.`,
    });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 상품 지급 처리 실패'} / ${MISSING_TABLE_HINT}`,
    }, { status: 500 });
  }
}
