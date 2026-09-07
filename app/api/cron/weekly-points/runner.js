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
import { AUTO_TABLE_HINT, getPreviousWeekRange, resolveStudyTier, evaluatePerfectAttendance, formatMinutesKo } from '../../../../lib/pointAutoRules';

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

/**
 * 지각 판정에 쓰는 허용치(분)만 읽습니다.
 *
 * 운영 기준 전체를 다루지 않는 이유: normalizeOperatingRules 가 이미 세 곳에
 * 복사돼 있어 네 번째 사본을 만들면 필드가 조용히 사라지는 사고가 반복됩니다.
 * 여기서 필요한 값은 이 하나뿐입니다.
 */
async function loadLateThresholdMinutes(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'operating_rules')
      .maybeSingle();
    if (error) throw error;
    const value = Number(data?.setting_value?.lateThresholdMinutes);
    return Number.isFinite(value) && value >= 0 ? value : 1;
  } catch {
    return 1;
  }
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
  // 개근 판정에는 날짜별 값이 필요합니다. (그날 순공시간 · 그날 등원 기록)
  const minutesByStudentDate = {};
  const sessionByStudentDate = {};
  for (const session of target) {
    const key = String(session.student_id);
    const date = String(session.session_date || '').slice(0, 10);
    const studyWindows = resolveScheduleForDate(scheduleConfig, session.session_date).studyWindows;
    const minutes = calculateScheduledPureStudyMinutes(session, {
      nowIso,
      events: eventsBySession[session.id] || [],
      studyWindows,
    });
    minutesByStudent[key] = (minutesByStudent[key] || 0) + minutes;
    if (!minutesByStudentDate[key]) minutesByStudentDate[key] = {};
    if (!sessionByStudentDate[key]) sessionByStudentDate[key] = {};
    // 같은 날 세션이 둘 이상이면(재등원 등) 합산하고, 대표 세션은 먼저 온 것으로 둡니다.
    minutesByStudentDate[key][date] = (minutesByStudentDate[key][date] || 0) + minutes;
    if (!sessionByStudentDate[key][date] || session.seat_status === 'absent') {
      sessionByStudentDate[key][date] = session;
    }
    if (session.check_in_at) daysByStudent[key] = (daysByStudent[key] || 0) + 1;
  }
  return { minutesByStudent, daysByStudent, minutesByStudentDate, sessionByStudentDate };
}

/** 그 주 개인 시간표 (예정 등원일 판정용) */
async function loadWeeklySchedules(supabase, week, studentIds) {
  try {
    const rows = await selectInChunks(studentIds, (part) => supabase
      .from('student_daily_schedules')
      .select('student_id, schedule_date, planned_check_in, planned_check_out, planned_absent')
      .in('student_id', part)
      .gte('schedule_date', week.start)
      .lte('schedule_date', week.end));
    const byStudent = {};
    for (const row of rows || []) {
      const key = String(row.student_id);
      if (!byStudent[key]) byStudent[key] = [];
      byStudent[key].push(row);
    }
    return { byStudent, warning: '' };
  } catch (error) {
    // planned_absent 컬럼이 없는 환경이면 그 컬럼 없이 다시 시도합니다.
    try {
      const rows = await selectInChunks(studentIds, (part) => supabase
        .from('student_daily_schedules')
        .select('student_id, schedule_date, planned_check_in, planned_check_out')
        .in('student_id', part)
        .gte('schedule_date', week.start)
        .lte('schedule_date', week.end));
      const byStudent = {};
      for (const row of rows || []) {
        const key = String(row.student_id);
        if (!byStudent[key]) byStudent[key] = [];
        byStudent[key].push(row);
      }
      return { byStudent, warning: '결석 일정(planned_absent) 컬럼이 없어 사전 신고 결석은 반영하지 않았습니다.' };
    } catch {
      return { byStudent: {}, warning: `개인 시간표를 읽지 못해 주간 개근 상점을 건너뛰었습니다. (${error?.message || '원인 미상'})` };
    }
  }
}

/**
 * 상점 한 건을 넣습니다. 자리(auto award)를 먼저 잡고 → 상점을 넣고 → 연결합니다.
 *
 * 순서가 중요합니다. 자리를 먼저 잡아야 같은 배치가 두 번 돌아도 유니크 인덱스가
 * 중복을 막습니다. 상점 기록이 실패하면 자리도 비워 다음 실행에서 다시 시도합니다.
 *
 * @returns {{status: 'awarded'|'duplicate'|'failed', row?: Object, message?: string}}
 */
async function insertAutoAward({ supabase, student, week, runDate, kind, points, studyMinutes, tierMinMinutes, tierLabel, reason, memo }) {
  const claim = await supabase
    .from('student_point_auto_awards')
    .insert({
      student_id: String(student.id),
      award_kind: kind,
      week_start: week.start,
      week_end: week.end,
      run_date: runDate,
      study_minutes: studyMinutes,
      tier_min_minutes: tierMinMinutes,
      tier_label: tierLabel || null,
      points,
      created_by: AUTO_AWARD_ACTOR,
    })
    .select()
    .single();

  if (claim.error) {
    if (isDuplicateKey(claim.error)) return { status: 'duplicate' };
    return { status: 'failed', message: claim.error.message || '자동 상점 기록 실패' };
  }

  const pointResult = await supabase
    .from('student_points')
    .insert({
      student_id: String(student.id),
      // 그 주에 대한 상점이므로 날짜는 집계한 주의 마지막 날(일요일)로 답니다.
      // 주간 리포트가 월~일을 보므로 이렇게 해야 해당 주 리포트에 함께 실립니다.
      point_date: week.end,
      point_type: 'reward',
      points,
      reason,
      memo,
      created_by: AUTO_AWARD_ACTOR,
      is_deleted: false,
    })
    .select()
    .single();

  if (pointResult.error) {
    await supabase.from('student_point_auto_awards').delete().eq('id', claim.data.id);
    return { status: 'failed', message: pointResult.error.message || '상점 기록 실패' };
  }

  await supabase
    .from('student_point_auto_awards')
    .update({ point_id: pointResult.data.id })
    .eq('id', claim.data.id);

  return { status: 'awarded', row: claim.data };
}

/** 1) 자동 상점 부여 — 주간 순공 구간 + 주간 개근 (둘 다 받을 수 있습니다) */
async function awardWeeklyPoints({ supabase, rules, week, runDate, students, minutesByStudent, minutesByStudentDate, sessionByStudentDate, schedulesByStudent, lateThresholdMinutes }) {
  const wantsStudy = rules.autoRewardEnabled && rules.tiers.length > 0;
  const wantsPerfect = rules.perfectAttendanceEnabled && rules.perfectAttendancePoints > 0;

  if (!rules.autoRewardEnabled) {
    return { awarded: [], failures: [], skipped: 'disabled', warning: '' };
  }
  if (!wantsStudy && !wantsPerfect) {
    return {
      awarded: [], failures: [], skipped: 'no-tiers',
      warning: '순공시간 구간표가 비어 있고 주간 개근 상점도 0점이라 자동 상점을 부여하지 않았습니다.',
    };
  }

  // 이미 이 주에 준 건은 건너뜁니다. (유니크 인덱스와 이중으로 막습니다)
  // 종류가 다르면 같은 주에도 각각 받을 수 있으므로 종류까지 묶어서 봅니다.
  let alreadyAwarded = new Set();
  try {
    const { data, error } = await supabase
      .from('student_point_auto_awards')
      .select('student_id, award_kind')
      .eq('week_start', week.start);
    if (error) throw error;
    alreadyAwarded = new Set((data || []).map((row) => `${row.student_id}::${row.award_kind || 'study'}`));
  } catch (error) {
    if (isMissingTable(error, 'student_point_auto_awards')) {
      return { awarded: [], failures: [], skipped: 'missing-table', warning: `자동 상점 표가 아직 없습니다. ${AUTO_TABLE_HINT}` };
    }
    throw error;
  }

  const awarded = [];
  const failures = [];

  for (const student of students) {
    const key = String(student.id);
    const minutes = Number(minutesByStudent[key] || 0);

    // ── 주간 순공 구간 상점 ──────────────────────────────
    const tier = wantsStudy ? resolveStudyTier(minutes, rules.tiers) : null;
    if (tier && !alreadyAwarded.has(`${key}::study`)) {
      const tierNote = tier.label
        ? `${tier.label} (${formatMinutesKo(tier.minMinutes)} 이상)`
        : `${formatMinutesKo(tier.minMinutes)} 이상`;
      const result = await insertAutoAward({
        supabase, student, week, runDate,
        kind: 'study',
        points: tier.points,
        studyMinutes: minutes,
        tierMinMinutes: tier.minMinutes,
        tierLabel: tier.label,
        reason: `주간 순공 자동 상점 · ${week.start}~${week.end} 순공 ${formatMinutesKo(minutes)}`,
        memo: `구간 ${tierNote} · ${runDate} 자동 부여`,
      });
      if (result.status === 'awarded') {
        awarded.push({
          studentId: key, name: student.name || '학생', kind: 'study',
          studyMinutes: minutes, studyLabel: formatMinutesKo(minutes),
          tierMinMinutes: tier.minMinutes, tierLabel: tier.label || '', points: tier.points,
        });
      } else if (result.status === 'failed') {
        failures.push({ studentId: key, name: student.name || '', kind: 'study', message: result.message });
      }
    }

    // ── 주간 개근 상점 ──────────────────────────────────
    // 순공 구간 상점과 별개입니다. 같은 주에 둘 다 받을 수 있습니다.
    if (!wantsPerfect || alreadyAwarded.has(`${key}::perfect`)) continue;
    const perfect = evaluatePerfectAttendance({
      schedules: schedulesByStudent[key] || [],
      sessionsByDate: sessionByStudentDate[key] || {},
      minutesByDate: minutesByStudentDate[key] || {},
      dailyMinMinutes: rules.perfectAttendanceDailyMinutes,
      lateThresholdMinutes,
    });
    if (!perfect.ok) continue;

    const result = await insertAutoAward({
      supabase, student, week, runDate,
      kind: 'perfect',
      points: rules.perfectAttendancePoints,
      studyMinutes: minutes,
      tierMinMinutes: rules.perfectAttendanceDailyMinutes,
      tierLabel: '주간 개근',
      reason: `주간 개근 자동 상점 · ${week.start}~${week.end} 등원 ${perfect.scheduledDays}일 무지각·무결석`,
      memo: `일일 최소 순공 ${formatMinutesKo(rules.perfectAttendanceDailyMinutes)} 충족 · ${runDate} 자동 부여`,
    });
    if (result.status === 'awarded') {
      awarded.push({
        studentId: key, name: student.name || '학생', kind: 'perfect',
        studyMinutes: minutes, studyLabel: formatMinutesKo(minutes),
        scheduledDays: perfect.scheduledDays, points: rules.perfectAttendancePoints,
      });
    } else if (result.status === 'failed') {
      failures.push({ studentId: key, name: student.name || '', kind: 'perfect', message: result.message });
    }
  }

  return { awarded, failures, skipped: '', warning: '' };
}

/** 그 주에 들어간 자동 상점 합계 (학생별). 표가 없으면 빈 값으로 둡니다. */
async function loadWeekAutoPoints(supabase, week) {
  try {
    const { data, error } = await supabase
      .from('student_point_auto_awards')
      .select('student_id, points')
      .eq('week_start', week.start);
    if (error) throw error;
    const totals = {};
    for (const row of data || []) {
      const key = String(row.student_id);
      totals[key] = (totals[key] || 0) + Number(row.points || 0);
    }
    return totals;
  } catch {
    return {};
  }
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
  const { minutesByStudent, daysByStudent, minutesByStudentDate, sessionByStudentDate } =
    await loadWeeklyStudyMinutes(supabase, week, studentIds);

  let awardResult = { awarded: [], failures: [], skipped: mode === 'scan' ? 'scan-only' : '', warning: '' };
  if (mode !== 'scan') {
    const [scheduleResult, lateThresholdMinutes] = await Promise.all([
      loadWeeklySchedules(supabase, week, studentIds),
      loadLateThresholdMinutes(supabase),
    ]);
    if (scheduleResult.warning) warnings.push(scheduleResult.warning);
    awardResult = await awardWeeklyPoints({
      supabase, rules, week, runDate, students,
      minutesByStudent, minutesByStudentDate, sessionByStudentDate,
      schedulesByStudent: scheduleResult.byStudent,
      lateThresholdMinutes,
    });
  }
  if (awardResult.warning) warnings.push(awardResult.warning);

  // 그 주에 실제로 들어간 자동 상점을 표에서 다시 읽어 합산합니다.
  //
  // 이번 실행에서 넣은 것만 세면 안 됩니다. 배치를 다시 돌리거나 mode=scan 으로
  // 명단만 갱신할 때는 새로 넣는 것이 없어, 스캔에 기록된 자동 상점이 0으로
  // 덮여 버립니다. (순공 구간 + 개근을 같은 주에 둘 다 받을 수 있어 합산합니다)
  const autoPointsByStudent = await loadWeekAutoPoints(supabase, week);

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
      perfectAttendanceEnabled: rules.perfectAttendanceEnabled,
      perfectAttendancePoints: rules.perfectAttendancePoints,
      perfectAttendanceDailyMinutes: rules.perfectAttendanceDailyMinutes,
    },
    cohort: cohortRange ? { id: cohortRange.id, name: cohortRange.name } : null,
    scopedToCohort,
    studentCount: students.length,
    attendedCount: Object.keys(daysByStudent).length,
    awarded: awardResult.awarded || [],
    awardedByKind: {
      study: (awardResult.awarded || []).filter((row) => row.kind === 'study').length,
      perfect: (awardResult.awarded || []).filter((row) => row.kind === 'perfect').length,
    },
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
