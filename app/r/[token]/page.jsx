import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
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

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value).slice(0, 10);
  }
}

function formatTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '-';
  }
}

function timeToMinutes(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function normalizePlannedTime(value, fallback = '09:00:00') {
  const raw = String(value || fallback || '').trim();
  const match = raw.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return fallback;
  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}:00`;
}

function normalizeDailySchedule(schedule = null) {
  return {
    ...(schedule || {}),
    planned_check_in: normalizePlannedTime(schedule?.planned_check_in || schedule?.plannedCheckIn, '09:00:00'),
    planned_check_out: normalizePlannedTime(schedule?.planned_check_out || schedule?.plannedCheckOut, '22:00:00'),
    is_default_schedule: !schedule?.id && !schedule?.plannedCheckOut,
  };
}

function getKstMinutesFromIso(value) {
  return timeToMinutes(formatTime(value));
}

function formatKst(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return '-';
  }
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

function calculateCurrentAwayMinutes(session = {}) {
  if (!session.away_started_at) return 0;
  return diffMinutesIso(session.away_started_at, session.check_out_at || new Date().toISOString());
}

function calculateLiveAwayMinutes(session = {}) {
  return Math.max(0, Number(session.away_total_minutes || 0) + calculateCurrentAwayMinutes(session));
}

// v41-111: 외출 사유 정리 + (외출~복귀) 구간 산출 — 학부모 링크에도 시간/사유를 보여줍니다.
function cleanAwayReasonText(memo) {
  let raw = String(memo || '').trim();
  for (const prefix of ['외출 사유:', '외출 사유：']) {
    if (raw.startsWith(prefix)) { raw = raw.slice(prefix.length).trim(); break; }
  }
  if (!raw) return '';
  if (['외출', '외출함', '잠시 외출', '자리비움', '외출 처리'].includes(raw)) return '';
  if (/재입실|재등원|자동|처리$/.test(raw)) return '';
  return raw;
}

function formatScheduleBreakReasonText(breakRow = {}) {
  const detail = String(breakRow.reason_detail || '').trim();
  const reason = String(breakRow.reason || '').trim();
  if (detail) return reason && reason !== '기타' ? `${reason}(${detail})` : detail;
  if (reason) return reason;
  return '';
}

function findOverlappingBreakReasonText(startIso, endIso, scheduleBreaks = []) {
  const startMin = getKstMinutesFromIso(startIso);
  if (startMin === null) return '';
  const endMin = endIso ? (getKstMinutesFromIso(endIso) ?? startMin + 1) : startMin + 1;
  let best = null;
  let bestOverlap = 0;
  for (const item of scheduleBreaks || []) {
    const leave = timeToMinutes(item.leave_start);
    if (leave === null) continue;
    const ret = timeToMinutes(item.return_time);
    const breakEnd = ret === null ? 1440 : ret;
    const overlap = Math.max(0, Math.min(endMin, breakEnd) - Math.max(startMin, leave));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = item;
    }
  }
  return best ? formatScheduleBreakReasonText(best) : '';
}

// 사유 우선순위: ① 외출 이벤트 메모 → ② 겹치는 개인 시간표 외출 → ③ 공란
function buildAwayIntervalsFromEvents(events = [], scheduleBreaks = []) {
  const sorted = [...(events || [])].filter((event) => event.event_at).sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
  const intervals = [];
  sorted.forEach((event, index) => {
    if (event.event_type !== 'away') return;
    const end = sorted.slice(index + 1).find((item) => ['return', 'check_in', 'check_out'].includes(item.event_type));
    const endAt = end?.event_at || null;
    const reason = cleanAwayReasonText(event.memo) || findOverlappingBreakReasonText(event.event_at, endAt, scheduleBreaks);
    intervals.push({ start: event.event_at, end: endAt, reason });
  });
  return intervals;
}

function calculateLivePureStudyMinutes(session = {}, events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { events, studyWindows });
}

function normalizeIssueSummaryText(value) {
  return String(value || '')
    .replace(/외출 확인 필요/g, '외출 관리 필요')
    .replace(/순공시간 확인 필요/g, '순공시간 부족')
    .replace(/(상점|벌점)\s*(\d+)점 발생\s*[:：]\s*([^,]+)/g, '$1 $2점 발생($3)')
    .trim();
}

function isParentReportIssueVisible(value = '') {
  const raw = String(value || '').trim();
  const base = raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+\d+일$/, '');
  return !['관리주의', '관리필요'].includes(base);
}

function splitIssueSummary(value) {
  const normalized = normalizeIssueSummaryText(value);
  if (!normalized || normalized === '특이사항 없음') return [];
  return normalized.split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean).filter(isParentReportIssueVisible);
}

function sanitizeParentIssueSummary(value = '') {
  const issues = splitIssueSummary(value);
  return issues.length ? issues.join(', ') : '특이사항 없음';
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function upsertAttendanceIssue(list, value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return;
  const base = cleanValue.replace(/\s*\([^)]*\)\s*$/, '');
  const existingIndex = list.findIndex((item) => String(item || '').replace(/\s*\([^)]*\)\s*$/, '') === base);
  if (existingIndex >= 0) list[existingIndex] = cleanValue;
  else list.push(cleanValue);
}

function getDailyIssueOrderKey(value = '') {
  const raw = String(value || '').trim();
  if (raw.startsWith('결석')) return 10;
  if (raw === '입실시간 누락') return 20;
  if (raw.startsWith('지각')) return 30;
  if (raw.startsWith('조퇴')) return 40;
  if (raw === '외출 관리 필요' || raw === '외출 확인 필요') return 60;
  if (raw === '순공시간 부족' || raw === '순공시간 확인 필요') return 70;
  if (/^(벌점|상점)\s*\d+점 발생/.test(raw)) return raw.startsWith('벌점') ? 80 : 90;
  if (raw === '특이사항 없음') return 999;
  return 500;
}

function formatDailyIssues(issues = []) {
  const normalized = (issues || []).map(normalizeIssueSummaryText).filter(Boolean).filter(isParentReportIssueVisible);
  const seen = new Set();
  const unique = [];
  for (const issue of normalized) {
    const base = issue.replace(/\s*\([^)]*\)\s*$/, '');
    const key = /^(상점|벌점)\s*\d+점 발생/.test(issue) ? issue : base;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  unique.sort((a, b) => getDailyIssueOrderKey(a) - getDailyIssueOrderKey(b));
  return unique.length ? unique.join(', ') : '특이사항 없음';
}

function stripAttendanceReasonPrefix(value, label = '') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const cleanLabel = String(label || '').trim();
  if (cleanLabel) {
    for (const prefix of [`${cleanLabel} 사유:`, `${cleanLabel} 사유：`]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
  }
  return raw;
}

function getEventReason(events = [], eventType = '', label = '') {
  const rows = (events || [])
    .filter((event) => event?.event_type === eventType && String(event.memo || '').trim())
    .sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));

  return stripAttendanceReasonPrefix(rows[0]?.memo || '', label);
}

function formatIssueWithReason(label, reason) {
  const cleanLabel = String(label || '').trim();
  const cleanReason = String(reason || '').trim();
  return cleanReason ? `${cleanLabel}(${cleanReason})` : cleanLabel;
}

function formatPointIssueLabel(row = {}) {
  const typeLabel = row.point_type === 'penalty' ? '벌점' : '상점';
  const points = Math.max(0, Math.round(Number(row.points || 0)));
  const reason = String(row.reason || '').trim() || '사유 미입력';
  return `${typeLabel} ${points}점 발생(${reason})`;
}

function createDailyPointIssueLabels(rows = []) {
  return (rows || [])
    .filter((row) => row && row.is_deleted !== true)
    .map(formatPointIssueLabel)
    .filter(Boolean);
}

function summarizePointRows(rows = []) {
  const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const net = reward - penalty;
  return { reward, penalty, net, count: rows.length };
}

function formatPointRow(row = {}) {
  const typeLabel = row.point_type === 'penalty' ? '벌점' : '상점';
  const sign = row.point_type === 'penalty' ? '-' : '+';
  const reason = String(row.reason || '').trim() || '사유 미입력';
  return `${row.point_date || '-'} · ${typeLabel} ${sign}${row.points || 0}점 · ${reason}`;
}

function getPureStudyDisplay(session = {}, variables = {}, events = [], studyWindows = undefined) {
  const liveMinutes = calculateLivePureStudyMinutes(session, events, studyWindows);
  const isLive = Boolean(session.check_in_at && !session.check_out_at);
  const label = formatMinutesKo(liveMinutes);
  return isLive ? `${label} (미퇴실 기준)` : label;
}

function safePayload(report = {}) {
  const raw = report.send_payload || {};
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function getTemplateVariables(report = {}) {
  const payload = safePayload(report);
  return payload.templateVariables || {};
}

function getDailyAttendanceTimeline(session = {}, events = []) {
  if (session.seat_status === 'absent') return `입실: - - 하원: ${formatIssueWithReason('결석', getEventReason(events, 'absent', '결석'))}`;

  const checkInLabel = session.check_in_at ? formatTime(session.check_in_at) : '-';
  let checkOutLabel = '입실 전';

  if (session.check_out_at) checkOutLabel = formatTime(session.check_out_at);
  else if (session.check_in_at) checkOutLabel = '학습중';

  return `입실: ${checkInLabel} - 하원: ${checkOutLabel}`;
}

function getLateIssueLabel(session = {}, schedule = null, rules = DEFAULT_OPERATING_RULES) {
  if (!session.check_in_at || session.seat_status === 'absent') return '';

  const normalizedSchedule = normalizeDailySchedule(schedule);
  // v41-42: 개인 시간표(또는 리포트 스냅샷)가 있는 날짜만 지각 판정.
  if (normalizedSchedule.is_default_schedule) return '';
  const plannedMinutes = timeToMinutes(normalizedSchedule.planned_check_in);
  const actualMinutes = getKstMinutesFromIso(session.check_in_at);
  const threshold = normalizeOperatingRules(rules).lateThresholdMinutes;

  if (plannedMinutes === null || actualMinutes === null) return '';
  return actualMinutes - plannedMinutes >= threshold ? '지각' : '';
}

function getEarlyLeaveIssueLabel(session = {}, schedule = null, rules = DEFAULT_OPERATING_RULES) {
  if (!session.check_out_at || session.seat_status === 'absent') return '';

  const normalizedSchedule = normalizeDailySchedule(schedule);
  // v41-42: 개인 시간표(또는 리포트 스냅샷)가 있는 날짜만 조퇴 판정.
  if (normalizedSchedule.is_default_schedule) return '';
  const plannedMinutes = timeToMinutes(normalizedSchedule.planned_check_out);
  const actualMinutes = getKstMinutesFromIso(session.check_out_at);
  const threshold = normalizeOperatingRules(rules).earlyLeaveThresholdMinutes;

  if (plannedMinutes === null || actualMinutes === null) return '';
  return plannedMinutes - actualMinutes >= threshold ? '조퇴' : '';
}

function getDailyCheckSummary(session = {}, variables = {}, events = [], dailyPointRows = [], schedule = null, rules = DEFAULT_OPERATING_RULES, studyWindows = undefined) {
  const issues = splitIssueSummary(variables.mainCheckSummary);

  const issueRules = normalizeOperatingRules(rules);

  if (!issues.length) {
    const awayMinutes = calculateLiveAwayMinutes(session);
    const pureMinutes = calculateLivePureStudyMinutes(session, events, studyWindows);
    if (session.seat_status === 'absent') upsertAttendanceIssue(issues, formatIssueWithReason('결석', getEventReason(events, 'absent', '결석')));
    if (['away', 'out'].includes(session.seat_status) && !session.check_in_at) pushUnique(issues, '입실시간 누락');
    if (awayMinutes >= issueRules.excessiveAwayMinutes) pushUnique(issues, '외출 관리 필요');
    if (pureMinutes > 0 && pureMinutes < issueRules.lowStudyMinutes) pushUnique(issues, '순공시간 부족');
  }

  if (session.seat_status === 'absent') upsertAttendanceIssue(issues, formatIssueWithReason('결석', getEventReason(events, 'absent', '결석')));

  const lateIssue = getLateIssueLabel(session, schedule, issueRules);
  if (lateIssue) upsertAttendanceIssue(issues, formatIssueWithReason(lateIssue, getEventReason(events, 'check_in', '지각')));

  const earlyLeaveIssue = getEarlyLeaveIssueLabel(session, schedule, issueRules);
  if (earlyLeaveIssue) upsertAttendanceIssue(issues, formatIssueWithReason(earlyLeaveIssue, getEventReason(events, 'check_out', '조퇴')));

  for (const pointIssue of createDailyPointIssueLabels(dailyPointRows)) pushUnique(issues, pointIssue);
  return formatDailyIssues(issues);
}

function getPlannerUrl(report = {}, planner = {}) {
  const payload = safePayload(report);
  // v41-110: 매 요청마다 새로 발급한 서명 URL을 우선 사용합니다.
  // 리포트 생성 시 저장된 서명 URL(plannerImageUrl)은 유효기간이 지나면 깨지므로,
  // 지난 날짜 리포트를 다시 열 때 이미지가 안 뜨던 문제를 방지합니다.
  return planner.signedUrl || payload.plannerImageUrl || '';
}

function cleanText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function extractBetween(text, startHeading, stopHeadings = []) {
  const normalized = cleanText(text);
  if (!normalized) return '';

  const startIndex = normalized.indexOf(startHeading);
  if (startIndex < 0) return '';

  let content = normalized.slice(startIndex + startHeading.length).replace(/^\n+/, '');
  for (const heading of stopHeadings) {
    const headingIndex = content.indexOf(`\n\n${heading}`);
    if (headingIndex >= 0) content = content.slice(0, headingIndex);
  }
  return content.trim();
}

function extractDailyLearningText(reportText) {
  const learning = extractBetween(reportText, '오늘의 학습 기록', ['학습멘토 코멘트']);
  if (learning) return learning;

  const normalized = cleanText(reportText);
  if (!normalized) return '오늘의 학습 기록이 아직 없습니다.';

  return normalized
    .replace(/\[비욘드 데일리 리포트\]\n*/g, '')
    .replace(/^학생:.*$/gm, '')
    .replace(/^학교\/학년:.*$/gm, '')
    .replace(/^좌석:.*$/gm, '')
    .replace(/^날짜:.*$/gm, '')
    .replace(/\n\n학습멘토 코멘트[\s\S]*$/m, '')
    .trim() || '오늘의 학습 기록이 아직 없습니다.';
}

function getWeeklySummaryRows(report = {}, summary = {}) {
  return [
    ['등원일수', `${summary.attendanceDays || 0}일`],
    ['총 순공시간', formatMinutesKo(summary.totalStudyMinutes || summary.totalStudy)],
    ['일평균 순공시간', formatMinutesKo(summary.averageStudyMinutes || summary.averageStudy)],
    ['외출', `${Number(summary.awayCount || 0)}회 / 총 ${formatMinutesKo(summary.awayMinutes || 0)}`],
    ['주요 확인사항', sanitizeParentIssueSummary(summary.issueSummary || '특이사항 없음')],
    ['상벌점', summary.pointSummary?.label || '상벌점 기록 없음'],
  ];
}

function getWeeklyDetailRows(summary = {}) {
  if (!Array.isArray(summary.rows)) return [];
  return summary.rows.map((row) => ({
    ...row,
    flags: Array.isArray(row.flags) ? row.flags.filter(isParentReportIssueVisible) : row.flags,
  }));
}

function buildWeeklyRowsFromSessions(sessions = [], eventsBySession = {}, scheduleConfig = null) {
  return (sessions || []).map((session) => {
    const studyWindows = resolveScheduleForDate(scheduleConfig, session.session_date).studyWindows;
    const pureStudyMinutes = calculateLivePureStudyMinutes(session, eventsBySession[session.id] || [], studyWindows);
    const awayMinutes = calculateLiveAwayMinutes(session);
    const flags = [];
    if (session.seat_status === 'absent') flags.push(formatIssueWithReason('결석', getEventReason(eventsBySession[session.id] || [], 'absent', '결석')));
    else if (!session.check_in_at) flags.push('미등원');
    if (session.seat_status === 'away') flags.push('외출중');
    if (session.check_in_at && !session.check_out_at) flags.push('학습중');
    if (session.check_in_at && pureStudyMinutes > 0 && pureStudyMinutes < 300) flags.push('순공부족');
    if (!flags.length) flags.push('정상');

    return {
      id: session.id,
      date: session.session_date,
      checkInTime: formatTime(session.check_in_at),
      checkOutTime: session.check_out_at ? formatTime(session.check_out_at) : (session.check_in_at ? '학습중' : '-'),
      pureStudyMinutes,
      awayMinutes,
      awayCount: Number(session.away_count || 0) || (awayMinutes > 0 ? 1 : 0),
      flags,
    };
  });
}

function summarizeWeeklyRows(savedSummary = {}, liveRows = []) {
  if (!liveRows.length) return savedSummary || {};
  const attendanceDays = liveRows.filter((row) => row.checkInTime && row.checkInTime !== '-').length;
  const totalStudyMinutes = liveRows.reduce((sum, row) => sum + Number(row.pureStudyMinutes || 0), 0);
  const awayCount = liveRows.reduce((sum, row) => sum + Number(row.awayCount || 0), 0);
  const awayMinutes = liveRows.reduce((sum, row) => sum + Number(row.awayMinutes || 0), 0);
  const issueCounts = { 결석: 0, 지각: 0, 조퇴: 0, 외출과다: 0, 순공부족: 0, 미등원: 0 };
  for (const row of liveRows) {
    for (const flag of row.flags || []) {
      const label = String(flag || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (Object.prototype.hasOwnProperty.call(issueCounts, label)) issueCounts[label] += 1;
    }
  }
  const issues = Object.entries(issueCounts).filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}일`).filter(isParentReportIssueVisible);

  return {
    ...savedSummary,
    attendanceDays,
    totalStudyMinutes,
    totalStudy: totalStudyMinutes,
    averageStudyMinutes: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    averageStudy: attendanceDays ? Math.round(totalStudyMinutes / attendanceDays) : 0,
    awayCount,
    awayMinutes,
    issueSummary: savedSummary.issueSummary && sanitizeParentIssueSummary(savedSummary.issueSummary) !== '특이사항 없음'
      ? sanitizeParentIssueSummary(savedSummary.issueSummary)
      : (issues.length ? issues.join(', ') : '특이사항 없음'),
    rows: liveRows,
  };
}

function Card({ title, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value, tone = '' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  );
}

function getDailyStayDisplay(session = {}) {
  if (!session.check_in_at) return '-';
  const end = session.check_out_at || new Date().toISOString();
  const label = formatMinutesKo(diffMinutesIso(session.check_in_at, end));
  return session.check_out_at ? label : `${label} (미퇴실 기준)`;
}

function getDailyCheckOutDisplay(session = {}) {
  if (session.check_out_at) return formatTime(session.check_out_at);
  if (session.check_in_at) return '학습중';
  return '-';
}

function stripLearningBullet(value = '') {
  return String(value || '').replace(/^\s*[·•-]\s*/, '').trim();
}

function splitPeriodText(periodText = '') {
  const raw = String(periodText || '').trim();
  const rangeMatch = raw.match(/(\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2})/);
  const timeRange = rangeMatch ? rangeMatch[1].replace(/[\-–]/, '~').replace(/\s+/g, '') : '';
  const title = timeRange ? raw.replace(rangeMatch[1], '').trim() || '학습 차시' : raw || '학습 차시';
  return { title, timeRange };
}

function parseDailyLearningPeriods(text = '') {
  const normalized = cleanText(text);
  if (!normalized || normalized.includes('아직 없습니다')) return [];

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const rows = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    // '체크 ...' 줄과, v41-98 이전에 저장된 옛 '학습 내용 및 특이사항 미입력' 문구는 내용에서 제외합니다.
    const contentLines = current.details.filter((line) => !line.startsWith('체크 ') && line.trim() !== '학습 내용 및 특이사항 미입력');
    const checkedLines = current.details.filter((line) => line.startsWith('체크 '));
    rows.push({
      ...current,
      content: contentLines.join('\n'),
      checkedNote: checkedLines.join(' / '),
    });
    current = null;
  };

  for (const line of lines) {
    const mainMatch = line.match(/^\d+\.\s*(.*?)\s*[-–]\s*(.+)$/);
    const looseMatch = line.match(/^((?:[^-–]*?\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}[^-–]*?))\s*[-–]\s*(.+)$/);
    const match = mainMatch || looseMatch;

    if (match) {
      commit();
      const { title, timeRange } = splitPeriodText(match[1]);
      current = { title, timeRange, status: match[2].trim() || '학습 상태 미입력', details: [] };
      continue;
    }

    if (!current) {
      current = { title: '학습 기록', timeRange: '', status: '학습 상태 미입력', details: [] };
    }
    current.details.push(stripLearningBullet(line));
  }

  commit();
  return rows.filter((row) => row.status || row.content);
}

// v41-108: 저장된 리포트 텍스트(스냅샷) 대신 study_checks 를 실시간으로 차시별로 묶어
// { title, timeRange, status, content, checkedNote } 형태의 행으로 만듭니다.
// 서버 /api/report 의 formatChecksBySchedulePeriod 와 같은 차시 매칭 규칙을 사용합니다.
function buildDailyLearningPeriodsFromChecks(checks = [], defaultSchedule = {}) {
  if (!Array.isArray(checks) || !checks.length) return [];
  const windows = Array.isArray(defaultSchedule?.studyWindows) ? defaultSchedule.studyWindows : [];
  const groups = new Map();

  checks.forEach((check, index) => {
    const checkedMinute = getKstMinutesFromIso(check.checked_at);
    let meta = null;
    if (checkedMinute !== null) {
      const matched = windows
        .map((item, windowIndex) => ({
          ...item,
          windowIndex,
          startMinute: timeToMinutes(item.start),
          endMinute: timeToMinutes(item.end),
        }))
        .find((item) => item.startMinute !== null && item.endMinute !== null && checkedMinute >= item.startMinute && checkedMinute < item.endMinute);
      if (matched) {
        meta = {
          key: `${matched.label || matched.windowIndex}-${matched.start}-${matched.end}`,
          sortMinute: matched.startMinute,
          title: matched.label || `${matched.windowIndex + 1}차시`,
          timeRange: `${matched.start}~${matched.end}`,
        };
      }
    }
    if (!meta) {
      const fallbackTime = formatTime(check.checked_at);
      meta = {
        key: `check-${check.id || check.checked_at || index}`,
        sortMinute: checkedMinute ?? 9999,
        title: '순찰 체크',
        timeRange: fallbackTime && fallbackTime !== '-' ? fallbackTime : '',
      };
    }
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, checks: [] });
    groups.get(meta.key).checks.push(check);
  });

  return [...groups.values()]
    .sort((a, b) => a.sortMinute - b.sortMinute)
    .map((group) => {
      const sorted = [...group.checks].sort((a, b) => new Date(a.checked_at || 0) - new Date(b.checked_at || 0));
      const status = [...new Set(sorted.map((check) => [check.subject, check.study_status].filter(Boolean).join(' / ')).filter(Boolean))].join(' → ') || '학습 상태 미입력';
      const content = [...new Set(sorted.map((check) => String(check.study_content || '').trim()).filter(Boolean))].join(' / ');
      const times = sorted.map((check) => formatTime(check.checked_at)).filter((value) => value && value !== '-');
      const checkedNote = times.length ? `체크 ${times.join(', ')}` : '';
      return { title: group.title, timeRange: group.timeRange, status, content, checkedNote };
    });
}

function ErrorPage({ title, message }) {
  return (
    <main className="public-report-page error-state-page">
      <style>{styles}</style>
      <section className="hero hero-error">
        <div className="hero-brand">
          <img src="/the-place-26-logo.png" alt="The Place 26" />
          <span>Beyond Report</span>
        </div>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
      <section className="link-error-card">
        <strong>리포트를 불러올 수 없습니다.</strong>
        <p>링크가 만료되었거나 비활성화되었을 수 있습니다. 확인이 필요하신 경우 학원으로 문의해 주세요.</p>
        <a href="tel:0317943306">031-794-3306</a>
      </section>
      <footer>
        <p>목동유쌤영어학원 · The Place 26</p>
      </footer>
    </main>
  );
}

async function getPlannerImage(supabase, session) {
  try {
    if (!session?.student_id || !session?.session_date) return null;
    const { data: planner } = await supabase
      .from('planner_photos')
      .select('*')
      .eq('student_id', session.student_id)
      .eq('planner_date', session.session_date)
      .maybeSingle();

    const path = planner?.file_path || planner?.photo_url;
    if (!path) return planner ? { ...planner, signedUrl: '' } : null;

    const { data: signed } = await supabase.storage
      .from('planner-photos')
      .createSignedUrl(path, 60 * 60);

    return { ...planner, signedUrl: signed?.signedUrl || '' };
  } catch {
    return null;
  }
}

async function getStudentPointRows(supabase, studentId, endDate = null) {
  if (!studentId) return [];
  try {
    let query = supabase
      .from('student_points')
      .select('id,point_date,point_type,points,reason,memo,created_at')
      .eq('student_id', String(studentId))
      .eq('is_deleted', false)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (endDate) query = query.lte('point_date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

async function loadReport(token) {
  const supabase = getSupabaseAdmin();
  const scheduleConfig = await getDefaultScheduleConfig(supabase);
  const nowIso = new Date().toISOString();

  const { data: link, error: linkError } = await supabase
    .from('report_share_links')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (linkError || !link) {
    return { error: 'invalid-link' };
  }

  await supabase
    .from('report_share_links')
    .update({ last_viewed_at: nowIso, view_count: Number(link.view_count || 0) + 1 })
    .eq('id', link.id);

  if (link.report_type === 'daily') {
    const { data: report, error: reportError } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('id', link.report_id)
      .maybeSingle();

    if (reportError || !report) return { error: 'report-not-found' };

    const { data: session } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .eq('id', report.session_id)
      .maybeSingle();

    let events = [];
    if (session?.id) {
      const { data: eventRows } = await supabase
        .from('attendance_events')
        .select('session_id,event_type,event_at,created_at,memo')
        .eq('session_id', session.id)
        .order('event_at', { ascending: true });
      events = eventRows || [];
    }

    // v41-108: 차시별 학습 내용을 리포트 생성 시점의 스냅샷이 아니라 실시간 순찰 체크로 렌더링합니다.
    // (링크 생성 이후에 기록/수정한 학습 내용도 학부모 링크에 즉시 반영됩니다.)
    let checks = [];
    if (session?.id) {
      const { data: checkRows } = await supabase
        .from('study_checks')
        .select('id,subject,study_status,study_content,checked_at')
        .eq('session_id', session.id)
        .order('checked_at', { ascending: true });
      checks = checkRows || [];
    }

    const planner = await getPlannerImage(supabase, session);
    const reportDate = session?.session_date || report.report_date || null;
    const pointRows = await getStudentPointRows(supabase, session?.student_id || report.student_id, reportDate);
    const dailyPointRows = reportDate ? pointRows.filter((row) => row.point_date === reportDate) : [];
    let schedule = normalizeDailySchedule(safePayload(report)?.scheduleSnapshot || null);
    // v41-112: 외출 사유 폴백용으로 개인 시간표 외출(student_schedule_breaks)을 함께 조회합니다.
    let scheduleBreaks = [];
    if (session?.student_id && reportDate) {
      try {
        const { data: scheduleRow } = await supabase
          .from('student_daily_schedules')
          .select('*')
          .eq('student_id', session.student_id)
          .eq('schedule_date', reportDate)
          .maybeSingle();
        schedule = normalizeDailySchedule(scheduleRow || schedule);
        if (scheduleRow?.id) {
          const { data: breakRows } = await supabase
            .from('student_schedule_breaks')
            .select('leave_start, return_time, reason, reason_detail')
            .eq('schedule_id', scheduleRow.id)
            .order('leave_start', { ascending: true });
          scheduleBreaks = breakRows || [];
        }
      } catch {
        schedule = normalizeDailySchedule(schedule);
      }
    }
    const operatingRules = safePayload(report)?.dailyIssueRules || await getOperatingRules(supabase);
    const defaultSchedule = resolveScheduleForDate(scheduleConfig, reportDate);
    return { link, reportType: 'daily', report, session, student: session?.students || null, planner, events, checks, scheduleBreaks, pointRows, dailyPointRows, schedule, operatingRules, defaultSchedule };
  }

  if (link.report_type === 'weekly') {
    const { data: report, error: reportError } = await supabase
      .from('weekly_reports')
      .select('*')
      .eq('id', link.report_id)
      .maybeSingle();

    if (reportError || !report) return { error: 'report-not-found' };

    const { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('id', report.student_id)
      .maybeSingle();

    const { data: weeklySessions } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('student_id', report.student_id)
      .gte('session_date', report.start_date)
      .lte('session_date', report.end_date)
      .order('session_date', { ascending: true });

    let weeklyEventsBySession = {};
    const sessionIds = (weeklySessions || []).map((session) => session.id).filter(Boolean);
    if (sessionIds.length) {
      const { data: eventRows } = await supabase
        .from('attendance_events')
        .select('session_id,event_type,event_at,created_at,memo')
        .in('session_id', sessionIds)
        .order('event_at', { ascending: true });
      for (const event of eventRows || []) {
        if (!weeklyEventsBySession[event.session_id]) weeklyEventsBySession[event.session_id] = [];
        weeklyEventsBySession[event.session_id].push(event);
      }
    }

    return { link, reportType: 'weekly', report, student, weeklySessions: weeklySessions || [], weeklyEventsBySession, scheduleConfig };
  }

  return { error: 'unknown-type' };
}

export default async function PublicReportPage({ params }) {
  const resolved = await params;
  const token = resolved?.token;
  const data = await loadReport(token);

  if (data.error) {
    return <ErrorPage title="리포트를 열 수 없습니다" message="링크가 만료되었거나 더 이상 사용 가능한 리포트가 아닙니다." />;
  }

  const { reportType, report, session, student, link, planner, events = [], checks = [], scheduleBreaks = [], weeklySessions = [], weeklyEventsBySession = {}, pointRows = [], dailyPointRows = [], schedule = null, operatingRules = DEFAULT_OPERATING_RULES, defaultSchedule = null, scheduleConfig = null } = data;
  const studyWindows = defaultSchedule?.studyWindows;
  const variables = getTemplateVariables(report);
  const isWeekly = reportType === 'weekly';
  const title = isWeekly ? '주간 학습 리포트' : '데일리 학습 리포트';
  const period = isWeekly
    ? `${report.start_date || '-'} ~ ${report.end_date || '-'}`
    : (session?.session_date || report.report_date || '-');

  const liveWeeklyRows = isWeekly ? buildWeeklyRowsFromSessions(weeklySessions, weeklyEventsBySession, scheduleConfig) : [];
  const weeklySummary = isWeekly ? summarizeWeeklyRows(report.summary_payload || {}, liveWeeklyRows) : {};
  const weeklyRows = getWeeklySummaryRows(report, weeklySummary);
  const savedWeeklyDetailRows = getWeeklyDetailRows(weeklySummary);
  const weeklyDetailRows = savedWeeklyDetailRows.length ? savedWeeklyDetailRows : liveWeeklyRows;
  const dailyPlannerUrl = !isWeekly ? getPlannerUrl(report, planner || {}) : '';
  const dailyLearningText = !isWeekly ? extractDailyLearningText(report.report_text) : '';
  // v41-108: 실시간 순찰 체크를 우선 사용하고, 없을 때만 저장된 리포트 텍스트 스냅샷으로 폴백합니다.
  const liveDailyPeriods = !isWeekly ? buildDailyLearningPeriodsFromChecks(checks, defaultSchedule) : [];
  const dailyLearningPeriods = liveDailyPeriods.length
    ? liveDailyPeriods
    : (!isWeekly ? parseDailyLearningPeriods(dailyLearningText) : []);
  const dailyPureStudyDisplay = !isWeekly ? getPureStudyDisplay(session || {}, variables, events, studyWindows) : '';
  const dailyAwayDisplay = !isWeekly ? (calculateLiveAwayMinutes(session || {}) ? formatMinutesKo(calculateLiveAwayMinutes(session || {})) : '외출 없음') : '';
  const dailyAwayIntervals = !isWeekly ? buildAwayIntervalsFromEvents(events, scheduleBreaks) : [];
  const dailyCheckSummary = !isWeekly ? getDailyCheckSummary(session || {}, variables, events, dailyPointRows, schedule, operatingRules, studyWindows) : '';
  const dailyPointSummary = !isWeekly ? summarizePointRows(pointRows) : { reward: 0, penalty: 0, net: 0, count: 0 };

  return (
    <main className="public-report-page">
      <style>{styles}</style>

      <section className="hero">
        <div className="hero-brand">
          <img src="/the-place-26-logo.png" alt="The Place 26" />
          <span>목동유쌤영어학원 · Beyond Report</span>
        </div>
        <h1>{title}</h1>
        <p>{student?.name || '학생'} · {period}</p>
      </section>

      <div className="meta-grid">
        <MetricCard label="학생" value={student?.name || '-'} />
        <MetricCard label="학교/학년" value={[student?.school, student?.grade].filter(Boolean).join(' ') || '-'} />
        {isWeekly ? <MetricCard label="리포트 종류" value="위클리" /> : null}
        <MetricCard label="열람 가능 기한" value={formatDate(link.expires_at)} />
      </div>

      {isWeekly ? (
        <>
          <div className="summary-grid">
            <MetricCard label="등원일수" value={`${weeklySummary.attendanceDays || 0}일`} />
            <MetricCard label="주간 순공시간" value={formatMinutesKo(weeklySummary.totalStudyMinutes || weeklySummary.totalStudy)} tone="good" />
            <MetricCard label="일평균 순공시간" value={formatMinutesKo(weeklySummary.averageStudyMinutes || weeklySummary.averageStudy)} />
            <MetricCard label="주요 확인사항" value={sanitizeParentIssueSummary(weeklySummary.issueSummary || variables.mainCheckSummary || '특이사항 없음')} tone={sanitizeParentIssueSummary(weeklySummary.issueSummary || variables.mainCheckSummary || '특이사항 없음') !== '특이사항 없음' ? 'warn' : 'good'} />
          </div>

          <Card title="이번 주 학습 요약">
            <dl className="summary-list">
              {weeklyRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || '-'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {weeklyDetailRows.length ? (
            <Card title="일자별 학습 기록">
              <div className="weekly-table-wrap">
                <table className="weekly-detail-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>입실</th>
                      <th>퇴실</th>
                      <th>순공</th>
                      <th>외출</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyDetailRows.map((row, index) => (
                      <tr key={row.id || `${row.date}-${index}`}>
                        <td>{row.date || '-'}</td>
                        <td>{row.checkInTime || '-'}</td>
                        <td>{row.checkOutTime || '-'}</td>
                        <td>{formatMinutesKo(row.pureStudyMinutes)}</td>
                        <td>{row.awayCount ? `${row.awayCount}회 · ${formatMinutesKo(row.awayMinutes)}` : '-'}</td>
                        <td>{Array.isArray(row.flags) && row.flags.length ? row.flags.join(', ') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {report.director_interview ? (
            <Card title="주간면담 내용">
              <p>{report.director_interview}</p>
            </Card>
          ) : null}

          {report.final_weekly_comment ? (
            <Card title="주간 총평">
              <p>{report.final_weekly_comment}</p>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <section className="parent-overview-card">
            <div className="section-eyebrow">오늘의 관리 요약</div>
            <div className="overview-grid">
              <MetricCard label="입실" value={formatTime(session?.check_in_at)} />
              <MetricCard label="퇴실" value={getDailyCheckOutDisplay(session || {})} />
              <MetricCard label="총 체류" value={getDailyStayDisplay(session || {})} />
              <MetricCard label="순공시간" value={dailyPureStudyDisplay} tone="good" />
              <MetricCard label="학습상태 기록" value={`${dailyLearningPeriods.length || 0}회`} />
            </div>
          </section>

          <div className="summary-grid compact-summary-grid">
            <MetricCard label="출결 요약" value={getDailyAttendanceTimeline(session || {}, events)} />
            <MetricCard label="외출" value={dailyAwayDisplay} />
            <MetricCard label="주요 확인사항" value={dailyCheckSummary} tone={dailyCheckSummary === '특이사항 없음' ? 'good' : 'warn'} />
          </div>

          {dailyAwayIntervals.length ? (
            <Card title="외출 내역">
              <p className="card-subtitle">외출 시각과 사유입니다. (총 {dailyAwayIntervals.length}회 · {dailyAwayDisplay})</p>
              <div className="away-interval-list">
                {dailyAwayIntervals.map((item, index) => (
                  <div key={`away-${index}`} className="away-interval-row">
                    <strong>{formatTime(item.start)} ~ {item.end ? formatTime(item.end) : '미복귀'}</strong>
                    <span>{item.reason ? item.reason : '사유 미기재'}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title="차시별 학습 내용">
            <p className="card-subtitle">순찰 체크가 속한 차시 전체 구간을 기준으로 정리했습니다.</p>
            {dailyLearningPeriods.length ? (
              <div className="learning-period-list">
                {dailyLearningPeriods.map((row, index) => (
                  <article key={`${row.title}-${row.timeRange}-${index}`} className="learning-period-card">
                    <div className="learning-period-head">
                      <span>{row.title}</span>
                      {row.timeRange ? <strong>{row.timeRange}</strong> : null}
                    </div>
                    <div className="learning-period-status">{row.status}</div>
                    {row.content ? <p>{row.content}</p> : null}
                    {row.checkedNote ? <small>{row.checkedNote}</small> : null}
                  </article>
                ))}
              </div>
            ) : (
              <pre>{dailyLearningText}</pre>
            )}
          </Card>

          {report.mentor_comment ? (
            <Card title="학습멘토 코멘트">
              <p>{report.mentor_comment}</p>
            </Card>
          ) : null}

          {dailyPlannerUrl ? (
            <Card title="플래너 이미지" className="planner-card">
              <img src={dailyPlannerUrl} alt={`${student?.name || '학생'} 플래너 이미지`} />
            </Card>
          ) : null}

          <Card title="상벌점 누적 현황" className="point-summary-card">
            <dl className="summary-list point-summary-list">
              <div>
                <dt>누적 상점</dt>
                <dd>{dailyPointSummary.reward}점</dd>
              </div>
              <div>
                <dt>누적 벌점</dt>
                <dd>{dailyPointSummary.penalty}점</dd>
              </div>
              <div>
                <dt>순점수</dt>
                <dd>{dailyPointSummary.net > 0 ? '+' : ''}{dailyPointSummary.net}점</dd>
              </div>
            </dl>
            {pointRows.length ? (
              <>
                <div className="point-recent-title">최근 상벌점 기록</div>
                <ul className="point-detail-list">
                  {pointRows.slice(0, 8).map((row) => (
                    <li key={row.id || `${row.point_date}-${row.reason}`}>{formatPointRow(row)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">상벌점 기록이 없습니다.</p>
            )}
          </Card>
        </>
      )}

      <footer>
        <p>본 링크는 학부모 열람용으로 제공되며, 외부 공유를 권장하지 않습니다.</p>
        <p>문의: 목동유쌤영어학원 031-794-3306</p>
        <p>열람 시각: {formatKst(new Date().toISOString())}</p>
      </footer>
    </main>
  );
}

const styles = `
  body {
    margin: 0;
    background: #f5f5f7;
    color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro KR", "SF Pro Text", "Segoe UI", "Apple SD Gothic Neo", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .public-report-page {
    width: min(920px, calc(100vw - 28px));
    margin: 0 auto;
    padding: 28px 0 42px;
  }
  .hero {
    padding: 32px;
    border-radius: 24px;
    background: #ffffff;
    border: 1px solid #e3e3e6;
    color: #1d1d1f;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  }
  .hero span {
    display: block;
    color: #0071e3;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: -.01em;
  }
  .hero h1 {
    margin: 0 0 8px;
    color: #1d1d1f !important;
    font-size: clamp(30px, 6vw, 46px);
    letter-spacing: -.03em;
    line-height: 1.08;
    font-weight: 800;
  }
  .hero p {
    margin: 0;
    color: #6e6e73;
    font-size: 16px;
    font-weight: 600;
  }
  .hero-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .hero-brand img {
    width: 34px;
    height: 34px;
    object-fit: contain;
    border-radius: 10px;
    background: #f5f5f7;
    padding: 4px;
  }
  .hero-brand span {
    margin: 0;
  }
  .parent-overview-card {
    margin: 14px 0;
    padding: 20px;
    border: 1px solid #e3e3e6;
    border-radius: 20px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  }
  .section-eyebrow {
    margin-bottom: 12px;
    color: #0071e3;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: -.01em;
  }
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
  }
  .compact-summary-grid {
    grid-template-columns: 1.2fr .8fr 1.2fr;
  }
  .card-subtitle {
    margin: -6px 0 14px !important;
    color: #6e6e73;
    font-size: 14px !important;
    font-weight: 600;
  }
  .away-interval-list {
    display: grid;
    gap: 8px;
  }
  .away-interval-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid #e3e3e6;
    border-radius: 14px;
    background: #fbfbfd;
  }
  .away-interval-row strong {
    color: #1d1d1f;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .away-interval-row span {
    color: #6e6e73;
    font-size: 14px;
    text-align: right;
  }
  .learning-period-list {
    display: grid;
    gap: 12px;
  }
  .learning-period-card {
    padding: 16px;
    border: 1px solid #e3e3e6;
    border-radius: 16px;
    background: #fbfbfd;
  }
  .learning-period-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .learning-period-head span {
    color: #1d1d1f;
    font-size: 14px;
    font-weight: 800;
  }
  .learning-period-head strong {
    padding: 5px 10px;
    border-radius: 999px;
    background: #eaf2fe;
    color: #0071e3;
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
  }
  .learning-period-status {
    color: #1d1d1f;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -.02em;
  }
  .learning-period-card p {
    margin-top: 8px;
    color: #424245;
    font-size: 15px;
    line-height: 1.65;
  }
  .learning-period-card small {
    display: block;
    margin-top: 8px;
    color: #86868b;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.45;
  }
  .link-error-card {
    margin-top: 14px;
    padding: 22px;
    border: 1px solid #e3e3e6;
    border-radius: 20px;
    background: #ffffff;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  }
  .link-error-card strong {
    display: block;
    margin-bottom: 8px;
    font-size: 20px;
    letter-spacing: -.03em;
  }
  .link-error-card p {
    margin: 0 auto 14px;
    max-width: 560px;
    color: #6e6e73;
    line-height: 1.65;
  }
  .link-error-card a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 20px;
    border-radius: 999px;
    background: #0071e3;
    color: #ffffff;
    font-weight: 700;
    text-decoration: none;
  }
  .meta-grid,
  .summary-grid {
    display: grid;
    gap: 10px;
    margin: 14px 0;
  }
  .meta-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .summary-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .metric-card,
  .card {
    border: 1px solid #e3e3e6;
    border-radius: 18px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .05);
  }
  .metric-card {
    display: grid;
    gap: 6px;
    padding: 15px;
    min-height: 74px;
    align-content: center;
  }
  .metric-card.good {
    background: #eaf2fe;
    border-color: #a9cbf5;
  }
  .metric-card.good span {
    color: #0071e3;
  }
  .metric-card.warn {
    background: #fff8e6;
    border-color: #f2d27a;
  }
  .metric-card span {
    color: #6e6e73;
    font-size: 12px;
    font-weight: 700;
  }
  .metric-card strong {
    color: #1d1d1f;
    font-size: 16px;
    line-height: 1.35;
    word-break: keep-all;
    overflow-wrap: anywhere;
    font-weight: 700;
  }
  .card {
    margin-top: 14px;
    padding: 23px;
  }
  .card h2 {
    margin: 0 0 14px;
    font-size: 22px;
    letter-spacing: -.035em;
    font-weight: 800;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: break-word;
    line-height: 1.75;
    font-family: inherit;
    font-size: 16px;
  }
  .card p {
    margin: 0;
    line-height: 1.75;
    font-size: 16px;
    white-space: pre-wrap;
    word-break: keep-all;
  }
  .summary-list {
    display: grid;
    gap: 10px;
    margin: 0;
  }
  .summary-list div {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: #f5f5f7;
  }
  .summary-list dt {
    color: #6e6e73;
    font-size: 13px;
    font-weight: 700;
  }
  .summary-list dd {
    margin: 0;
    color: #1d1d1f;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.45;
  }
  .weekly-table-wrap {
    overflow-x: auto;
  }
  .weekly-detail-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    min-width: 680px;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid #e3e3e6;
  }
  .weekly-detail-table th,
  .weekly-detail-table td {
    padding: 10px 11px;
    border-bottom: 1px solid #ededf0;
    text-align: left;
    font-size: 13px;
    line-height: 1.45;
  }
  .weekly-detail-table th {
    background: #f5f5f7;
    color: #1d1d1f;
    font-weight: 800;
  }
  .weekly-detail-table tr:last-child td {
    border-bottom: 0;
  }
  .planner-card img {
    display: block;
    width: 100%;
    max-height: 720px;
    object-fit: contain;
    border-radius: 16px;
    background: #f5f5f7;
  }
  .point-summary-card {
    border-color: #a9cbf5;
    background: #eaf2fe;
  }
  .point-summary-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .point-summary-list dd {
    font-size: 23px;
    color: #0071e3;
  }
  .point-recent-title {
    margin-top: 14px;
    color: #0071e3;
    font-size: 13px;
    font-weight: 800;
  }
  .point-detail-list {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #424245;
    line-height: 1.7;
    font-size: 14px;
    font-weight: 600;
  }
  .muted {
    color: #86868b;
  }
  footer {
    margin-top: 18px;
    color: #86868b;
    font-size: 12px;
    line-height: 1.55;
    text-align: center;
  }
  footer p {
    margin: 4px 0;
  }
  @media (max-width: 760px) {
    .public-report-page {
      width: min(100vw - 20px, 920px);
      padding: 16px 0 32px;
    }
    .hero {
      padding: 22px;
      border-radius: 24px;
    }
    .meta-grid,
    .summary-grid,
    .overview-grid,
    .compact-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .learning-period-head {
      align-items: flex-start;
      flex-direction: column;
    }
    .summary-list div {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
  @media (max-width: 480px) {
    .meta-grid,
    .summary-grid,
    .overview-grid,
    .compact-summary-grid {
      grid-template-columns: 1fr;
    }
    .parent-overview-card {
      padding: 14px;
      border-radius: 20px;
    }
    .metric-card {
      min-height: 64px;
    }
    .card {
      padding: 18px;
    }
    pre, .card p {
      font-size: 15px;
    }
  }
`;
