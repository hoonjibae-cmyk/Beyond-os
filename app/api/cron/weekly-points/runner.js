// Beyond OS v41-241
// 매주 월요일 06:00(KST)에 도는 상벌점 주간 배치입니다.
//
// 두 가지를 순서대로 합니다.
//   1) 자동 상점 부여 — 지난 월~일 순공시간을 학생별로 합산해 구간표대로 상점을 넣습니다.
//   2) 상품 지급 대상 스캔 — 그 결과까지 반영한 순점수를 전원 스캔해 명단을 남깁니다.
//
// 순서가 중요합니다. 자동 상점을 먼저 넣어야, 그 상점 덕분에 기준을 넘긴 학생이
// 같은 월요일 명단에 함께 오릅니다.
//
// 다시 돌려도 안전합니다.
//   - 상점: (student_id, week_start) 유니크 인덱스가 중복 부여를 막습니다.
//   - 스캔: (student_id, scan_date) 로 덮어씁니다.

import { selectInChunks } from '../../../../lib/supabaseChunk';
import { calculateScheduledPureStudyMinutes } from '../../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../../lib/defaultSchedule';
import { getKstDateString } from '../../../../lib/date';
import { loadCohortRange, loadCohortStudentIds } from '../../../../lib/cohortScope';
import { getPointAutoRules } from '../../../../lib/pointAutoRulesServer';
import { resolvePointCyclesByStudent } from '../../../../lib/studentPointCycle';
import { AUTO_TABLE_HINT, getPreviousWeekRange, resolveStudyTier, formatMinutesKo } from '../../../../lib/pointAutoRules';

export const AUTO_AWARD_ACTOR = '시스템 자동';

function isMissingTable(error, table) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || message.includes(table)
    || message.includes('does not exist')
    || message.includes('schema cache');
}

function isDuplicateKey(error) {
  return String(error?.code || '') === '23505';
}

/** 대상 학생 명단. 기수 명단을 못 읽으면 활성 학생 전원으로 떨어집니다. */
async function loadTargetStudents(supabase, cohortRange) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, school, grade, status');
  if (error) throw error;
  const all = (data || []).filter((row) => row?.status !== 'inactive');

  let rosterIds = null;
  if (cohortRange?.id) {
    try {
      rosterIds = await loadCohortStudentIds(supabase, cohortRange.id);
    } catch {
      rosterIds = null;
    }
  }
  // 명단을 읽었는데 0명이면 "전원"이 아니라 "대상 없음"입니다. 절대 섞지 마세요.
  if (Array.isArray(rosterIds)) {
    const set = new Set(rosterIds.map(String));
    return { students: all.filter((row) => set.has(String(row.id))), scopedToCohort: true };
  }
  return { students: all, scopedToCohort: false };
}

/** 지난 주 학생별 순공시간(분) */
async function loadWeeklyStudyMinutes(supabase, week, studentIds) {
  const idSet = new Set(studentIds.map(String));
  const scheduleConfig = await getDefaultScheduleConfig(supabase);

  const { data: sessions, error } = await supabase
    .from('daily_sessions')
    .select('id,student_id,session_date,check_in_at,check_out_at,seat_status,pure_study_minutes,away_total_minutes,away_started_at')
    .gte('session_date', week.start)
    .lte('session_date', week.end);
  if (error) throw error;

  const target = (sessions || []).filter((row) => idSet.has(String(row.student_id)));
  const events = await selectInChunks(target.map((row) => row.id), (part) => supabase
    .from('attendance_events')
    .select('*')
    .in('session_id', part));

  const eventsBySession = {};
  for (const event of events || []) {
    if (!eventsBySession[event.session_id]) eventsBySession[event.session_id] = [];
    eventsBySession[event.session_id].push(event);
  }

  // 하원 처리가 안 된 채 남은 세션이 있으면 "지금까지"로 계산되어 값이 부풀 수 있습니다.
  // 집계 대상 주의 마지막 순간으로 잘라 그 주 안의 시간만 셉니다.
  const nowIso = `${week.end}T23:59:59+09:00`;

  const minutesByStudent = {};
  const daysByStudent = {};
  for (const session of target) {
    const key = String(session.student_id);
    const studyWindows = resolveScheduleForDate(scheduleConfig, session.session_date).studyWindows;
    minutesByStudent[key] = (minutesByStudent[key] || 0) + calculateScheduledPureStudyMinutes(session, {
      nowIso,
      events: eventsBySession[session.id] || [],
      studyWindows,
    });
    if (session.check_in_at) daysByStudent[key] = (daysByStudent[key] || 0) + 1;
  }
  return { minutesByStudent, daysByStudent };
}

/** 1) 자동 상점 부여 */
async function awardWeeklyPoints({ supabase, rules, week, runDate, students, minutesByStudent }) {
  if (!rules.autoRewardEnabled) {
    return { awarded: [], skipped: 'disabled', warning: '' };
  }
  if (!rules.tiers.length) {
    return { awarded: [], skipped: 'no-tiers', warning: '순공시간 구간표가 비어 있어 자동 상점을 부여하지 않았습니다.' };
  }

  // 이미 이 주에 준 학생은 건너뜁니다. (유니크 인덱스와 이중으로 막습니다)
  let alreadyAwarded = new Set();
  try {
    const { data, error } = await supabase
      .from('student_point_auto_awards')
      .select('student_id')
      .eq('week_start', week.start);
    if (error) throw error;
    alreadyAwarded = new Set((data || []).map((row) => String(row.student_id)));
  } catch (error) {
    if (isMissingTable(error, 'student_point_auto_awards')) {
      return { awarded: [], skipped: 'missing-table', warning: `자동 상점 표가 아직 없습니다. ${AUTO_TABLE_HINT}` };
    }
    throw error;
  }

  const awarded = [];
  const failures = [];

  for (const student of students) {
    const key = String(student.id);
    if (alreadyAwarded.has(key)) continue;
    const minutes = Number(minutesByStudent[key] || 0);
    const tier = resolveStudyTier(minutes, rules.tiers);
    if (!tier) continue;

    // 자리를 먼저 잡습니다. 여기서 중복이 나면 다른 실행이 이미 준 것이므로 넘어갑니다.
    const claim = await supabase
      .from('student_point_auto_awards')
      .insert({
        student_id: key,
        week_start: week.start,
        week_end: week.end,
        run_date: runDate,
        study_minutes: minutes,
        tier_min_minutes: tier.minMinutes,
        tier_label: tier.label || null,
        points: tier.points,
        created_by: AUTO_AWARD_ACTOR,
      })
      .select()
      .single();

    if (claim.error) {
      if (isDuplicateKey(claim.error)) continue;
      failures.push({ studentId: key, name: student.name || '', message: claim.error.message || '자동 상점 기록 실패' });
      continue;
    }

    const tierNote = tier.label
      ? `${tier.label} (${formatMinutesKo(tier.minMinutes)} 이상)`
      : `${formatMinutesKo(tier.minMinutes)} 이상`;

    const pointResult = await supabase
      .from('student_points')
      .insert({
        student_id: key,
        // 그 주에 대한 상점이므로 날짜는 집계한 주의 마지막 날(일요일)로 답니다.
        // 주간 리포트가 월~일을 보므로 이렇게 해야 해당 주 리포트에 함께 실립니다.
        point_date: week.end,
        point_type: 'reward',
        points: tier.points,
        reason: `주간 순공 자동 상점 · ${week.start}~${week.end} 순공 ${formatMinutesKo(minutes)}`,
        memo: `구간 ${tierNote} · ${runDate} 자동 부여`,
        created_by: AUTO_AWARD_ACTOR,
        is_deleted: false,
      })
      .select()
      .single();

    if (pointResult.error) {
      // 상점이 안 들어갔으면 자리도 비웁니다. 다음 실행에서 다시 시도합니다.
      await supabase.from('student_point_auto_awards').delete().eq('id', claim.data.id);
      failures.push({ studentId: key, name: student.name || '', message: pointResult.error.message || '상점 기록 실패' });
      continue;
    }

    await supabase
      .from('student_point_auto_awards')
      .update({ point_id: pointResult.data.id })
      .eq('id', claim.data.id);

    awarded.push({
      studentId: key,
      name: student.name || '학생',
      studyMinutes: minutes,
      studyLabel: formatMinutesKo(minutes),
      tierMinMinutes: tier.minMinutes,
      tierLabel: tier.label || '',
      points: tier.points,
    });
  }

  return { awarded, failures, skipped: '', warning: '' };
}

/** 2) 상품 지급 대상 주간 스캔 */
async function scanRewardTargets({ supabase, rules, week, runDate, students, cohortRange, minutesByStudent, autoPointsByStudent }) {
  let pointQuery = supabase
    .from('student_points')
    .select('id,student_id,point_date,point_type,points,created_at')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (cohortRange) pointQuery = pointQuery.gte('point_date', cohortRange.start).lte('point_date', cohortRange.end);
  const { data: pointRows, error: pointError } = await pointQuery;
  if (pointError) throw pointError;

  let rewardRows = [];
  try {
    let rewardQuery = supabase
      .from('student_point_rewards')
      .select('*')
      .order('created_at', { ascending: true });
    if (cohortRange) {
      rewardQuery = rewardQuery
        .gte('created_at', `${cohortRange.start}T00:00:00+09:00`)
        .lte('created_at', `${cohortRange.end}T23:59:59+09:00`);
    }
    const { data, error } = await rewardQuery;
    if (error) throw error;
    rewardRows = data || [];
  } catch (error) {
    if (!isMissingTable(error, 'student_point_rewards')) throw error;
  }

  const cycles = resolvePointCyclesByStudent(pointRows || [], rewardRows, { threshold: rules.rewardThreshold });

  // 직전 스캔 결과 (연속 주 수 계산용)
  let previousByStudent = {};
  try {
    const { data, error } = await supabase
      .from('student_point_weekly_scans')
      .select('student_id, scan_date, is_eligible, streak_weeks')
      .lt('scan_date', runDate)
      .order('scan_date', { ascending: true });
    if (error) throw error;
    // 오름차순으로 덮어쓰면 학생별 마지막(=가장 최근) 스캔만 남습니다.
    for (const row of data || []) previousByStudent[String(row.student_id)] = row;
  } catch (error) {
    if (isMissingTable(error, 'student_point_weekly_scans')) {
      return { rows: [], eligible: [], warning: `주간 스캔 표가 아직 없습니다. ${AUTO_TABLE_HINT}` };
    }
    throw error;
  }

  const payloads = students.map((student) => {
    const key = String(student.id);
    const cycle = cycles[key] || { net: 0, reward: 0, penalty: 0, count: 0 };
    const isEligible = Number(cycle.net || 0) > rules.rewardThreshold;
    const previous = previousByStudent[key];
    // 직전 스캔에서도 대상이었으면 이어서 셉니다.
    // 중간에 배치를 건너뛴 주가 있어도 끊지 않습니다. (연속의 기준은 '스캔 회차'입니다)
    const streak = isEligible
      ? (previous?.is_eligible ? Number(previous.streak_weeks || 1) + 1 : 1)
      : 0;
    return {
      student_id: key,
      scan_date: runDate,
      week_start: week.start,
      week_end: week.end,
      threshold: rules.rewardThreshold,
      net_points: Number(cycle.net || 0),
      reward_points: Number(cycle.reward || 0),
      penalty_points: Number(cycle.penalty || 0),
      entry_count: Number(cycle.count || 0),
      study_minutes: Number(minutesByStudent[key] || 0),
      auto_points: Number(autoPointsByStudent[key] || 0),
      is_eligible: isEligible,
      streak_weeks: streak,
    };
  });

  if (payloads.length) {
    const { error } = await supabase
      .from('student_point_weekly_scans')
      .upsert(payloads, { onConflict: 'student_id,scan_date' });
    if (error) throw error;
  }

  return {
    rows: payloads,
    eligible: payloads.filter((row) => row.is_eligible),
    warning: '',
  };
}

/**
 * 주간 배치 본체.
 *
 * @param {Object}  options
 * @param {Object}  options.supabase
 * @param {string} [options.runDate] 실행 날짜(KST). 비우면 오늘.
 * @param {string} [options.mode]    'full'(기본) 이면 상점 부여 + 스캔, 'scan' 이면 스캔만.
 */
export async function runWeeklyPointBatch({ supabase, runDate: requestedRunDate, mode = 'full' } = {}) {
  const runDate = /^\d{4}-\d{2}-\d{2}$/.test(String(requestedRunDate || '')) ? String(requestedRunDate) : getKstDateString();
  const week = getPreviousWeekRange(runDate);
  const rules = await getPointAutoRules(supabase);
  const cohortRange = await loadCohortRange(supabase, '', runDate);
  const { students, scopedToCohort } = await loadTargetStudents(supabase, cohortRange);

  const warnings = [];
  if (!students.length) {
    return {
      ok: true, runDate, week, mode,
      cohort: cohortRange ? { id: cohortRange.id, name: cohortRange.name } : null,
      studentCount: 0, awarded: [], eligible: [],
      warning: '대상 학생이 없어 아무것도 하지 않았습니다.',
    };
  }

  const studentIds = students.map((row) => String(row.id));
  const { minutesByStudent, daysByStudent } = await loadWeeklyStudyMinutes(supabase, week, studentIds);

  let awardResult = { awarded: [], failures: [], skipped: mode === 'scan' ? 'scan-only' : '', warning: '' };
  if (mode !== 'scan') {
    awardResult = await awardWeeklyPoints({ supabase, rules, week, runDate, students, minutesByStudent });
  }
  if (awardResult.warning) warnings.push(awardResult.warning);

  const autoPointsByStudent = {};
  for (const row of awardResult.awarded || []) autoPointsByStudent[row.studentId] = row.points;

  const scanResult = await scanRewardTargets({
    supabase, rules, week, runDate, students, cohortRange, minutesByStudent, autoPointsByStudent,
  });
  if (scanResult.warning) warnings.push(scanResult.warning);

  const nameById = {};
  for (const student of students) nameById[String(student.id)] = student.name || '학생';

  return {
    ok: true,
    runDate,
    week,
    mode,
    rules: {
      autoRewardEnabled: rules.autoRewardEnabled,
      tierCount: rules.tiers.length,
      rewardThreshold: rules.rewardThreshold,
      streakWeeks: rules.streakWeeks,
    },
    cohort: cohortRange ? { id: cohortRange.id, name: cohortRange.name } : null,
    scopedToCohort,
    studentCount: students.length,
    attendedCount: Object.keys(daysByStudent).length,
    awarded: awardResult.awarded || [],
    awardFailures: awardResult.failures || [],
    awardSkipped: awardResult.skipped || '',
    eligible: (scanResult.eligible || []).map((row) => ({
      studentId: row.student_id,
      name: nameById[row.student_id] || '학생',
      net: row.net_points,
      streakWeeks: row.streak_weeks,
    })),
    scannedCount: (scanResult.rows || []).length,
    warning: warnings.filter(Boolean).join(' / '),
  };
}
