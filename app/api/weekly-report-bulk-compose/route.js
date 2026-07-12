import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

const DEFAULT_OPERATING_RULES = {
  lowStudyMinutes: 300,
  lateThresholdMinutes: 5,
  earlyLeaveThresholdMinutes: 10,
  excessiveAwayCount: 2,
  excessiveAwayMinutes: 60,
};

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizeOperatingRules(value = {}) {
  const merged = { ...DEFAULT_OPERATING_RULES, ...(value || {}) };
  const toNumber = (input, fallback) => {
    const n = Number(input);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    lowStudyMinutes: toNumber(merged.lowStudyMinutes, DEFAULT_OPERATING_RULES.lowStudyMinutes),
    lateThresholdMinutes: toNumber(merged.lateThresholdMinutes, DEFAULT_OPERATING_RULES.lateThresholdMinutes),
    earlyLeaveThresholdMinutes: toNumber(merged.earlyLeaveThresholdMinutes, DEFAULT_OPERATING_RULES.earlyLeaveThresholdMinutes),
    excessiveAwayCount: toNumber(merged.excessiveAwayCount, DEFAULT_OPERATING_RULES.excessiveAwayCount),
    excessiveAwayMinutes: toNumber(merged.excessiveAwayMinutes, DEFAULT_OPERATING_RULES.excessiveAwayMinutes),
  };
}

async function getOperatingRules(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'operating_rules')
      .maybeSingle();
    if (error) throw error;
    return normalizeOperatingRules(data?.setting_value || DEFAULT_OPERATING_RULES);
  } catch {
    return normalizeOperatingRules(DEFAULT_OPERATING_RULES);
  }
}

function formatKstTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function timeToMinutes(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}시간 ${mins}분`;
  if (hours) return `${hours}시간`;
  return `${mins}분`;
}

function diffMinutesIso(startIso, endIso = new Date().toISOString()) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function averageClock(rows = [], key = '') {
  const values = rows.map((row) => timeToMinutes(row[key])).filter((value) => value !== null);
  if (!values.length) return '';
  const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const hour = Math.floor(avg / 60);
  const minute = avg % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function cleanReason(value = '', label = '') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const cleanLabel = String(label || '').trim();
  if (cleanLabel) {
    for (const prefix of [`${cleanLabel} 사유:`, `${cleanLabel} 사유：`, `${cleanLabel}:`, `${cleanLabel}：`]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
  }
  return raw;
}

function getLatestEventReason(events = [], eventType = '', label = '') {
  const rows = (events || [])
    .filter((event) => event?.event_type === eventType && String(event.memo || '').trim())
    .sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));
  return cleanReason(rows[0]?.memo || '', label);
}

function createFlag(label, type, reason = '') {
  return { label, type, reason: cleanReason(reason, label) };
}

function getAttendanceFlags(row = {}, rules = DEFAULT_OPERATING_RULES) {
  const flags = [];
  const checkInMinute = timeToMinutes(row.checkInTime);
  const checkOutMinute = timeToMinutes(row.checkOutTime);
  const plannedIn = timeToMinutes(row.plannedCheckInTime || row.plannedCheckIn);
  const plannedOut = timeToMinutes(row.plannedCheckOutTime || row.plannedCheckOut);

  if (row.status === 'absent') {
    flags.push(createFlag('결석', 'danger', row.absentReason));
    return flags;
  }

  if (!row.checkInAt) {
    flags.push(createFlag('미등원', 'warning', row.attendanceMemo || row.absentReason));
  }

  if (checkInMinute !== null && plannedIn !== null && checkInMinute > plannedIn + rules.lateThresholdMinutes) {
    flags.push(createFlag('지각', 'warning', row.lateReason));
  }

  if (checkOutMinute !== null && plannedOut !== null && checkOutMinute < plannedOut - rules.earlyLeaveThresholdMinutes) {
    flags.push(createFlag('조퇴', 'warning', row.earlyLeaveReason));
  }

  if (Number(row.awayCount || 0) > rules.excessiveAwayCount || Number(row.awayMinutes || 0) > rules.excessiveAwayMinutes) {
    flags.push(createFlag('외출과다', 'warning'));
  }

  if (row.checkInAt && Number(row.pureStudyMinutes || 0) < rules.lowStudyMinutes) {
    flags.push(createFlag('순공부족', 'warning'));
  }

  return flags;
}

function reasonBucketKey(reason = '') {
  const clean = String(reason || '').trim();
  return clean || '사유 미입력';
}

function formatIssueSummary(counts = {}, reasonCounts = {}) {
  const parts = [];
  for (const label of ['결석', '지각', '조퇴', '외출과다', '순공부족', '미등원']) {
    const count = Number(counts[label] || 0);
    if (!count) continue;
    const reasons = reasonCounts[label] || {};
    const reasonParts = Object.entries(reasons)
      .filter(([, value]) => Number(value || 0) > 0)
      .slice(0, 2)
      .map(([reason, value]) => `${reason} ${value}회`);
    parts.push(`${label} ${count}일${reasonParts.length ? `(${reasonParts.join(', ')})` : ''}`);
  }
  return parts.length ? parts.join(', ') : '특이사항 없음';
}

function formatFlagDisplay(flag = {}) {
  return flag.reason ? `${flag.label}(${flag.reason})` : flag.label;
}

function summarizePointRows(rows = []) {
  const safeRows = (rows || []).filter((row) => row && row.is_deleted !== true);
  const reward = safeRows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = safeRows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const net = reward - penalty;
  const recent = safeRows.slice(0, 5).map((row) => `${row.point_type === 'reward' ? '상점' : '벌점'} ${row.points}점 · ${row.reason || '-'}`);
  return {
    reward,
    penalty,
    net,
    count: safeRows.length,
    recent,
    label: safeRows.length ? `상점 ${reward}점 / 벌점 ${penalty}점 / 순점수 ${net > 0 ? '+' : ''}${net}점` : '상벌점 기록 없음',
  };
}

function createWeeklyComment(student = {}, summary = {}) {
  const name = student.name || '학생';
  const issues = summary.issueSummary && summary.issueSummary !== '특이사항 없음' ? summary.issueSummary : '';
  const study = formatMinutesKo(summary.totalStudyMinutes || 0);
  const average = formatMinutesKo(summary.averageStudyMinutes || 0);
  const attendanceDays = Number(summary.attendanceDays || 0);

  if (!attendanceDays) {
    return `${name} 학생은 이번 주 비욘드 학습 기록이 아직 충분히 누적되지 않았습니다. 다음 주에는 등원 루틴과 학습 시작 시간을 우선적으로 점검하겠습니다.`;
  }

  const base = `${name} 학생은 이번 주 ${attendanceDays}일 등원하여 총 ${study}, 일평균 ${average}의 순공시간을 기록했습니다.`;
  const issueText = issues ? ` 이번 주 주요 확인사항은 ${issues}입니다.` : ' 이번 주 출결과 학습 흐름에서 큰 특이사항은 없었습니다.';
  const next = ' 다음 주에도 출결 루틴과 차시별 학습 집중도를 함께 점검하며 안정적인 학습 흐름이 이어지도록 관리하겠습니다.';
  return `${base}${issueText}${next}`;
}

function buildReportText({ student = {}, startDate, endDate, summary = {}, interview = '', finalComment = '' }) {
  const comment = String(finalComment || '').trim() || createWeeklyComment(student, summary);
  const interviewText = String(interview || '').trim() || '이번 주 주간면담 내용은 별도 입력 전입니다.';
  return `[비욘드 주간 리포트]\n\n학생: ${student.name || '-'}\n기간: ${startDate} ~ ${endDate}\n\n이번 주 학습 요약\n- 등원일수: ${summary.attendanceDays || 0}일\n- 총 순공시간: ${formatMinutesKo(summary.totalStudyMinutes || 0)}\n- 일평균 순공시간: ${formatMinutesKo(summary.averageStudyMinutes || 0)}\n- 외출: ${summary.awayCount || 0}회 / 총 ${formatMinutesKo(summary.awayMinutes || 0)}\n- 주요 확인사항: ${summary.issueSummary || '특이사항 없음'}\n- 상벌점: ${summary.pointSummary?.label || '상벌점 기록 없음'}\n\n주간면담 내용\n${interviewText}\n\n주간 총평\n${comment}\n\n목동유쌤영어학원`;
}

function buildRowsFromSessions({ sessions = [], eventsBySession = {}, reportsBySession = {}, schedulesByDate = {}, scheduleConfig = null, rules = DEFAULT_OPERATING_RULES }) {
  const rows = (sessions || []).map((session) => {
    const events = eventsBySession[session.id] || [];
    const schedule = schedulesByDate[session.session_date] || {};
    const defaultSchedule = resolveScheduleForDate(scheduleConfig, session.session_date);
    const awayMinutes = Math.max(
      0,
      Number(session.away_total_minutes || 0) + (session.away_started_at ? diffMinutesIso(session.away_started_at, session.check_out_at || new Date().toISOString()) : 0)
    );
    const awayCount = events.filter((event) => event.event_type === 'away').length || (awayMinutes > 0 ? 1 : 0);
    const report = reportsBySession[session.id] || {};
    const row = {
      id: session.id,
      date: session.session_date,
      studentId: session.student_id,
      status: session.seat_status,
      checkInAt: session.check_in_at,
      checkOutAt: session.check_out_at,
      checkInTime: formatKstTime(session.check_in_at),
      checkOutTime: session.check_out_at ? formatKstTime(session.check_out_at) : '',
      awayMinutes,
      awayCount,
      pureStudyMinutes: calculateScheduledPureStudyMinutes(session, { events, studyWindows: defaultSchedule.studyWindows }),
      plannedCheckIn: schedule.planned_check_in || `${defaultSchedule.plannedCheckIn || '09:00'}:00`,
      plannedCheckOut: schedule.planned_check_out || `${defaultSchedule.plannedCheckOut || '22:00'}:00`,
      plannedCheckInTime: schedule.planned_check_in || `${defaultSchedule.plannedCheckIn || '09:00'}:00`,
      plannedCheckOutTime: schedule.planned_check_out || `${defaultSchedule.plannedCheckOut || '22:00'}:00`,
      mentorComment: report.mentor_comment || '',
      attendanceMemo: session.attendance_memo || '',
      absentReason: getLatestEventReason(events, 'absent', '결석'),
      lateReason: getLatestEventReason(events, 'check_in', '지각'),
      earlyLeaveReason: getLatestEventReason(events, 'check_out', '조퇴'),
    };
    const flags = getAttendanceFlags(row, rules);
    return { ...row, flags };
  });

  return rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function createSummaryPayload({ rows = [], pointSummary = {} }) {
  const totalStudyMinutes = rows.reduce((sum, row) => sum + Number(row.pureStudyMinutes || 0), 0);
  const attendanceDays = rows.filter((row) => Boolean(row.checkInAt)).length;
  const awayCount = rows.reduce((sum, row) => sum + Number(row.awayCount || 0), 0);
  const awayMinutes = rows.reduce((sum, row) => sum + Number(row.awayMinutes || 0), 0);
  const issueCounts = { 결석: 0, 지각: 0, 조퇴: 0, 외출과다: 0, 순공부족: 0, 미등원: 0 };
  const issueReasons = { 결석: {}, 지각: {}, 조퇴: {} };

  const detailRows = rows.map((row) => {
    for (const flag of row.flags || []) {
      if (Object.prototype.hasOwnProperty.call(issueCounts, flag.label)) issueCounts[flag.label] += 1;
      if (flag.reason && issueReasons[flag.label]) {
        const key = reasonBucketKey(flag.reason);
        issueReasons[flag.label][key] = Number(issueReasons[flag.label][key] || 0) + 1;
      }
    }
    return {
      id: row.id,
      date: row.date,
      checkInTime: row.checkInTime,
      checkOutTime: row.checkOutTime,
      pureStudyMinutes: row.pureStudyMinutes,
      awayCount: row.awayCount,
      awayMinutes: row.awayMinutes,
      flags: (row.flags || []).map(formatFlagDisplay),
    };
  });

  return {
    attendanceDays,
    totalStudyMinutes,
    totalStudy: totalStudyMinutes,
    averageStudyMinutes: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    averageStudy: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    averageCheckIn: averageClock(rows, 'checkInTime'),
    averageCheckOut: averageClock(rows, 'checkOutTime'),
    awayCount,
    awayMinutes,
    issueCounts,
    issueReasons,
    issueSummary: formatIssueSummary(issueCounts, issueReasons),
    pointSummary,
    rows: detailRows,
  };
}

async function fetchPointRows(supabase, studentId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('student_points')
      .select('id,point_date,point_type,points,reason,memo,created_at,is_deleted')
      .eq('student_id', String(studentId))
      .gte('point_date', startDate)
      .lte('point_date', endDate)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

async function processStudent({ supabase, student, startDate, endDate, existingReport, scheduleConfig, rules, mode, actorName }) {
  const shouldSkipExisting = mode === 'missing' && existingReport?.report_text;
  if (shouldSkipExisting) {
    return { ok: true, skipped: true, studentId: student.id, studentName: student.name, reason: '이미 저장된 위클리 리포트가 있습니다.' };
  }

  const { data: sessions, error: sessionError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', student.id)
    .gte('session_date', startDate)
    .lte('session_date', endDate)
    .order('session_date', { ascending: true });
  if (sessionError) throw sessionError;

  const sessionIds = (sessions || []).map((session) => session.id).filter(Boolean);
  let eventsBySession = {};
  let reportsBySession = {};

  if (sessionIds.length) {
    const { data: eventRows, error: eventError } = await supabase
      .from('attendance_events')
      .select('*')
      .in('session_id', sessionIds)
      .order('event_at', { ascending: true });
    if (eventError) throw eventError;
    for (const event of eventRows || []) {
      if (!eventsBySession[event.session_id]) eventsBySession[event.session_id] = [];
      eventsBySession[event.session_id].push(event);
    }

    const { data: dailyReports } = await supabase
      .from('daily_reports')
      .select('id,session_id,mentor_comment')
      .in('session_id', sessionIds);
    for (const report of dailyReports || []) reportsBySession[report.session_id] = report;
  }

  let schedulesByDate = {};
  try {
    const { data: scheduleRows } = await supabase
      .from('student_daily_schedules')
      .select('*')
      .eq('student_id', student.id)
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate);
    for (const schedule of scheduleRows || []) schedulesByDate[schedule.schedule_date] = schedule;
  } catch {}

  const pointRows = await fetchPointRows(supabase, student.id, startDate, endDate);
  const pointSummary = summarizePointRows(pointRows);
  const rows = buildRowsFromSessions({ sessions: sessions || [], eventsBySession, reportsBySession, schedulesByDate, scheduleConfig, rules });
  const summaryPayload = createSummaryPayload({ rows, pointSummary });
  const existingInterview = existingReport?.director_interview || '';
  const existingAiComment = existingReport?.ai_weekly_comment || '';
  const finalWeeklyComment = existingReport?.final_weekly_comment || createWeeklyComment(student, summaryPayload);
  const reportText = buildReportText({
    student,
    startDate,
    endDate,
    summary: summaryPayload,
    interview: existingInterview,
    finalComment: finalWeeklyComment,
  });

  const payload = {
    student_id: student.id,
    start_date: startDate,
    end_date: endDate,
    summary_payload: {
      ...summaryPayload,
      autoComposedAt: new Date().toISOString(),
      autoComposedBy: actorName,
      autoComposeVersion: 'v41-24',
    },
    director_interview: existingInterview || null,
    ai_weekly_comment: existingAiComment || null,
    final_weekly_comment: finalWeeklyComment || null,
    report_text: reportText,
    created_by: actorName,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: saveError } = await supabase
    .from('weekly_reports')
    .upsert(payload, { onConflict: 'student_id,start_date,end_date' })
    .select()
    .single();
  if (saveError) throw saveError;

  return {
    ok: true,
    skipped: false,
    studentId: student.id,
    studentName: student.name,
    reportId: saved?.id,
    mode: existingReport?.id ? 'updated' : 'created',
    attendanceDays: summaryPayload.attendanceDays,
    totalStudyMinutes: summaryPayload.totalStudyMinutes,
    issueSummary: summaryPayload.issueSummary,
  };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const startDate = toDate(body.startDate);
    const endDate = toDate(body.endDate);
    const mode = ['all', 'missing', 'selected'].includes(body.mode) ? body.mode : 'missing';
    const selectedIds = Array.isArray(body.studentIds) ? body.studentIds.map(String).filter(Boolean) : [];

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate, endDate are required' }, { status: 400 });
    }
    if (mode === 'selected' && !selectedIds.length) {
      return Response.json({ error: 'selected mode requires studentIds' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const rules = await getOperatingRules(supabase);

    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('id,name,school,grade,status,parent_phone')
      .order('name', { ascending: true });
    if (studentError) throw studentError;

    const candidates = (students || [])
      .filter((student) => student.status !== 'inactive')
      .filter((student) => mode === 'selected' ? selectedIds.includes(String(student.id)) : true);

    const { data: existingRows, error: existingError } = await supabase
      .from('weekly_reports')
      .select('*')
      .eq('start_date', startDate)
      .eq('end_date', endDate);
    if (existingError) throw existingError;
    const existingByStudent = new Map((existingRows || []).map((report) => [String(report.student_id), report]));

    const results = [];
    for (const student of candidates) {
      try {
        const result = await processStudent({
          supabase,
          student,
          startDate,
          endDate,
          existingReport: existingByStudent.get(String(student.id)),
          scheduleConfig,
          rules,
          mode,
          actorName,
        });
        results.push(result);
      } catch (error) {
        results.push({
          ok: false,
          skipped: false,
          studentId: student.id,
          studentName: student.name,
          error: error.message || 'Unknown error',
        });
      }
    }

    const summary = {
      total: results.length,
      created: results.filter((row) => row.ok && !row.skipped && row.mode === 'created').length,
      updated: results.filter((row) => row.ok && !row.skipped && row.mode === 'updated').length,
      skipped: results.filter((row) => row.ok && row.skipped).length,
      failed: results.filter((row) => !row.ok).length,
    };

    await writeUserActionLog(supabase, request, {
      actionType: 'weekly_report.bulk_compose',
      targetType: 'weekly_report',
      targetId: null,
      targetName: `${startDate} ~ ${endDate}`,
      payload: {
        startDate,
        endDate,
        mode,
        summary,
        failed: results.filter((row) => !row.ok).slice(0, 20),
      },
    });

    return Response.json({ ok: true, startDate, endDate, mode, summary, results });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
