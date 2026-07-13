import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { ensureReportShareLink } from '../../../lib/reportShare';
import { validateKakaoTemplateVariables } from '../../../lib/reportTemplateValidation';
import { diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

const WEBHOOK_URL = process.env.REPORT_SEND_WEBHOOK_URL || process.env.KAKAO_REPORT_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.REPORT_SEND_WEBHOOK_SECRET || process.env.KAKAO_SEND_WEBHOOK_SECRET || '';

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
    // v40-6 운영 기준 SQL 미실행 환경에서도 리포트 발송 자체는 막지 않습니다.
    return normalizeOperatingRules(DEFAULT_OPERATING_RULES);
  }
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function getReportGuardians(student = {}, reportType = 'daily') {
  const rows = Array.isArray(student.student_guardians) ? student.student_guardians : [];
  const active = rows.filter((item) => item.is_active !== false && normalizePhone(item.phone));
  const targeted = active.filter((item) => reportType === 'weekly' ? item.receive_weekly_report !== false : item.receive_daily_report !== false);
  const usable = targeted.length ? targeted : active;

  if (usable.length) {
    return usable.map((item, index) => ({
      id: item.id,
      name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
      relationship: item.relationship || '',
      phone: item.phone || '',
      phoneDigits: normalizePhone(item.phone),
      isPrimary: Boolean(item.is_primary),
    }));
  }

  const fallback = normalizePhone(student.parent_phone);
  return fallback ? [{
    id: 'legacy-parent-phone',
    name: '대표 보호자',
    relationship: '대표 보호자',
    phone: student.parent_phone,
    phoneDigits: fallback,
    isPrimary: true,
  }] : [];
}

function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}시간 ${mins}분`;
  if (hours) return `${hours}시간`;
  return `${mins}분`;
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

function getKstMinutesFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch {
    // fallback 아래에서 처리
  }

  return timeToMinutes(formatKstTime(value));
}

function normalizeDailySchedule(schedule = null, defaultSchedule = null) {
  const fallbackIn = `${defaultSchedule?.plannedCheckIn || '09:00'}:00`;
  const fallbackOut = `${defaultSchedule?.plannedCheckOut || '22:00'}:00`;
  return {
    ...(schedule || {}),
    planned_check_in: normalizePlannedTime(schedule?.planned_check_in, fallbackIn),
    planned_check_out: normalizePlannedTime(schedule?.planned_check_out, fallbackOut),
    is_default_schedule: !schedule?.id,
  };
}

function calculateCurrentAwayMinutes(session = {}, nowIso = new Date().toISOString()) {
  if (!session.away_started_at || session.check_out_at) return 0;
  return diffMinutes(session.away_started_at, nowIso);
}

function calculateLiveAwayMinutes(session = {}, nowIso = new Date().toISOString()) {
  return Math.max(0, Number(session.away_total_minutes || 0) + calculateCurrentAwayMinutes(session, nowIso));
}

function calculateLivePureStudyMinutes(session = {}, nowIso = new Date().toISOString(), events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { nowIso, events, studyWindows });
}

function getLateIssueLabel(session = {}, schedule = null, rules = DEFAULT_OPERATING_RULES, defaultSchedule = null) {
  if (!session.check_in_at) return '';
  // v41-42: 개인 시간표가 저장된 날짜만 지각 판정. (기본 시간표 폴백 기준 판정 제거)
  if (!schedule?.id) return '';

  const normalizedSchedule = normalizeDailySchedule(schedule, defaultSchedule);
  const plannedMinutes = timeToMinutes(normalizedSchedule.planned_check_in);
  const actualMinutes = getKstMinutesFromIso(session.check_in_at);
  const threshold = normalizeOperatingRules(rules).lateThresholdMinutes;

  if (plannedMinutes === null || actualMinutes === null) return '';
  const diff = actualMinutes - plannedMinutes;

  return diff >= threshold ? '지각' : '';
}

function getEarlyLeaveIssueLabel(session = {}, schedule = null, rules = DEFAULT_OPERATING_RULES, defaultSchedule = null) {
  if (!session.check_out_at || session.seat_status === 'absent') return '';
  // v41-42: 개인 시간표가 저장된 날짜만 조퇴 판정. (기본 시간표 폴백 기준 판정 제거)
  if (!schedule?.id) return '';

  const normalizedSchedule = normalizeDailySchedule(schedule, defaultSchedule);
  const plannedMinutes = timeToMinutes(normalizedSchedule.planned_check_out);
  const actualMinutes = getKstMinutesFromIso(session.check_out_at);
  const threshold = normalizeOperatingRules(rules).earlyLeaveThresholdMinutes;

  if (plannedMinutes === null || actualMinutes === null) return '';
  const diff = plannedMinutes - actualMinutes;

  return diff >= threshold ? '조퇴' : '';
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
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

function normalizeDailyIssueLabel(value = '') {
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

function formatDailyIssues(issues = []) {
  const normalized = (issues || []).map(normalizeDailyIssueLabel).filter(Boolean).filter(isParentReportIssueVisible);
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

async function getDailyPointRows(supabase, studentId, reportDate) {
  if (!studentId || !reportDate) return [];
  try {
    const { data, error } = await supabase
      .from('student_points')
      .select('id,point_date,point_type,points,reason,memo,created_at')
      .eq('student_id', String(studentId))
      .eq('is_deleted', false)
      .eq('point_date', reportDate)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch {
    // v40-90 상벌점 SQL 미실행 환경에서도 리포트 발송 자체는 막지 않습니다.
    return [];
  }
}

function getDailyAttendanceStatus(session = {}) {
  if (session.seat_status === 'absent') return '결석';
  if (session.seat_status === 'away') return '외출';
  if (session.seat_status === 'out') return '퇴실';
  if (session.seat_status === 'occupied') return '학습중';
  if (session.seat_status === 'needs_attention') return session.check_out_at ? '퇴실' : (session.check_in_at ? '학습중' : '입실 전');
  if (session.check_in_at) return '등원';
  return '입실 전';
}

function getReportLink(report = {}) {
  return report.report_url || report.public_url || report.share_url || '';
}

function createDailyMainCheckSummary(session = {}, awayCount = 0, schedule = null, nowIso = new Date().toISOString(), events = [], pointRows = [], rules = DEFAULT_OPERATING_RULES, defaultSchedule = null) {
  const issueRules = normalizeOperatingRules(rules);
  const issues = [];
  const pureMinutes = calculateLivePureStudyMinutes(session, nowIso, events, defaultSchedule?.studyWindows);
  const awayMinutes = calculateLiveAwayMinutes(session, nowIso);
  const lateIssue = getLateIssueLabel(session, schedule, issueRules, defaultSchedule);
  const earlyLeaveIssue = getEarlyLeaveIssueLabel(session, schedule, issueRules, defaultSchedule);

  if (session.seat_status === 'absent') pushUnique(issues, formatIssueWithReason('결석', getEventReason(events, 'absent', '결석')));
  if (['away', 'out'].includes(session.seat_status) && !session.check_in_at) pushUnique(issues, '입실시간 누락');
  if (lateIssue) pushUnique(issues, formatIssueWithReason(lateIssue, getEventReason(events, 'check_in', '지각')));
  if (earlyLeaveIssue) pushUnique(issues, formatIssueWithReason(earlyLeaveIssue, getEventReason(events, 'check_out', '조퇴')));
  if (awayCount >= issueRules.excessiveAwayCount || awayMinutes >= issueRules.excessiveAwayMinutes) pushUnique(issues, '외출 관리 필요');
  if (pureMinutes > 0 && pureMinutes < issueRules.lowStudyMinutes) pushUnique(issues, '순공시간 부족');
  for (const pointIssue of createDailyPointIssueLabels(pointRows)) pushUnique(issues, pointIssue);

  return formatDailyIssues(issues);
}

function createDailyTemplateVariables({ student = {}, session = {}, report = {}, awayCount = 0, reportLink = '', schedule = null, nowIso = new Date().toISOString(), events = [], pointRows = [], rules = DEFAULT_OPERATING_RULES, defaultSchedule = null }) {
  const livePureStudyMinutes = calculateLivePureStudyMinutes(session, nowIso, events, defaultSchedule?.studyWindows);
  const variables = {
    studentName: student.name || '',
    date: session.session_date || '',
    attendanceStatus: getDailyAttendanceStatus(session),
    pureStudyTime: formatMinutesKo(livePureStudyMinutes),
    mainCheckSummary: createDailyMainCheckSummary(session, awayCount, schedule, nowIso, events, pointRows, rules, defaultSchedule),
    reportLink: reportLink || getReportLink(report),
  };

  return {
    ...variables,
    kakaoVariables: {
      '#{학생명}': variables.studentName,
      '#{날짜}': variables.date,
      '#{출결상태}': variables.attendanceStatus,
      '#{순공시간}': variables.pureStudyTime,
      '#{확인사항}': variables.mainCheckSummary,
      '#{리포트링크}': variables.reportLink,
    },
    sourceMap: {
      '#{학생명}': 'students.name',
      '#{날짜}': 'daily_sessions.session_date',
      '#{출결상태}': 'daily_sessions.seat_status',
      '#{순공시간}': '출결시간 - 외출 - 기본 쉬는시간 기준 실시간 순공시간 계산값',
      '#{확인사항}': 'daily_sessions + attendance_events + student_daily_schedules + operating_rules + student_points 계산값',
      '#{리포트링크}': 'report_url/public_url/share_url',
    },
  };
}

async function getPlannerImageUrl(supabase, session) {
  try {
    const { data: planner } = await supabase
      .from('planner_photos')
      .select('*')
      .eq('student_id', session.student_id)
      .eq('planner_date', session.session_date)
      .maybeSingle();

    const path = planner?.file_path || planner?.photo_url;
    if (!path) return { planner, plannerImageUrl: null };

    const { data: signed } = await supabase.storage
      .from('planner-photos')
      .createSignedUrl(path, 60 * 60 * 6);

    return { planner, plannerImageUrl: signed?.signedUrl || null };
  } catch {
    return { planner: null, plannerImageUrl: null };
  }
}

async function safeUpdateReport(supabase, reportId, fullPayload, fallbackPayload) {
  const { data, error } = await supabase
    .from('daily_reports')
    .update(fullPayload)
    .eq('id', reportId)
    .select()
    .single();

  if (!error) return data;

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('daily_reports')
    .update(fallbackPayload)
    .eq('id', reportId)
    .select()
    .single();

  if (fallbackError) throw fallbackError;
  return fallbackData;
}

async function safeInsertLog(supabase, payload) {
  try {
    await supabase.from('report_send_logs').insert(payload);
  } catch {
    // v31 SQL 미실행 상태에서도 발송 워크플로우 자체는 막지 않습니다.
  }
}

const WEBHOOK_TIMEOUT_MS = 10000;

function mapWebhookStatusToBeyondStatus(rawStatus, ok) {
  const status = String(rawStatus || '').toLowerCase();

  if (['sent', 'delivered', 'success', 'completed'].includes(status)) return 'sent';
  if (['failed', 'error', 'rejected', 'undelivered'].includes(status)) return 'failed';
  if (['received', 'queued', 'accepted', 'ready', 'pending', 'requested'].includes(status)) return 'ready';

  // 안전장치: Webhook 서버가 정상 응답만 주고 실제 발송완료 여부를 명시하지 않으면 발송대기로 둡니다.
  return ok ? 'ready' : 'failed';
}

function normalizeWebhookResult(response, json, text) {
  const bodyOk = typeof json?.ok === 'boolean' ? json.ok : response.ok;
  const transportOk = Boolean(response.ok && bodyOk !== false);
  const providerStatus = String(json?.status || '').toLowerCase();
  const mappedStatus = mapWebhookStatusToBeyondStatus(providerStatus, transportOk);
  const ok = transportOk && mappedStatus !== 'failed';

  return {
    configured: true,
    ok,
    status: mappedStatus,
    providerStatus: providerStatus || (response.ok ? 'received' : 'failed'),
    provider: json?.provider || 'webhook',
    response: json || text,
    requestId: json?.requestId || json?.request_id || null,
    errorCode: mappedStatus === 'failed' ? (json?.errorCode || json?.error_code || `HTTP_${response.status}`) : null,
    recipientPolicy: json?.recipientPolicy || null,
    recipientResults: Array.isArray(json?.recipientResults) ? json.recipientResults : [],
    recipientStats: json?.recipientStats || null,
    partialSuccess: Boolean(json?.partialSuccess || json?.recipientStats?.partialSuccess),
    message: json?.message || (mappedStatus === 'sent' ? '카카오 발송이 완료되었습니다.' : mappedStatus === 'ready' ? '발송 서버가 요청을 접수했습니다. 실제 발송 완료 전까지 발송대기로 표시합니다.' : '카카오 발송 요청이 실패했습니다.'),
    httpStatus: response.status,
  };
}

async function callWebhook(payload) {
  if (!WEBHOOK_URL) {
    return {
      configured: false,
      ok: false,
      status: 'ready',
      provider: 'kakao_pending',
      message: 'REPORT_SEND_WEBHOOK_URL이 아직 설정되지 않아 발송대기 상태로 저장했습니다.',
      errorCode: 'WEBHOOK_NOT_CONFIGURED',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SECRET ? { 'x-beyond-webhook-secret': WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return normalizeWebhookResult(response, json, text);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      configured: true,
      ok: false,
      status: 'failed',
      provider: 'webhook',
      response: null,
      errorCode: timedOut ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_REQUEST_ERROR',
      message: timedOut
        ? '발송 서버 응답이 10초를 초과해 발송 실패로 기록했습니다.'
        : (error.message || 'Webhook 요청 중 오류가 발생했습니다.'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'dailyReports');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = body.action || 'preview';
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    if (!body.sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*, students(*, student_guardians(*))')
      .eq('id', body.sessionId)
      .single();

    if (sessionError) throw sessionError;

    const defaultSchedule = resolveScheduleForDate(scheduleConfig, session.session_date);

    const { data: report, error: reportError } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('session_id', body.sessionId)
      .maybeSingle();

    if (reportError) throw reportError;

    if (!report?.report_text) {
      return Response.json({
        error: '먼저 데일리 리포트를 생성하세요.',
        code: 'REPORT_NOT_READY',
      }, { status: 400 });
    }

    const student = session.students || {};
    const recipients = getReportGuardians(student, 'daily');
    const recipientPhone = recipients[0]?.phoneDigits || '';
    const { plannerImageUrl } = await getPlannerImageUrl(supabase, session);

    let attendanceEvents = [];
    let awayCount = 0;
    try {
      const { data: eventRows } = await supabase
        .from('attendance_events')
        .select('event_type,event_at,created_at,memo')
        .eq('session_id', session.id)
        .order('event_at', { ascending: true });
      attendanceEvents = eventRows || [];
      awayCount = attendanceEvents.filter((event) => event.event_type === 'away').length;
    } catch {
      attendanceEvents = [];
      awayCount = 0;
    }

    let schedule = null;
    try {
      const { data: scheduleRow } = await supabase
        .from('student_daily_schedules')
        .select('*')
        .eq('student_id', student.id)
        .eq('schedule_date', session.session_date)
        .maybeSingle();
      schedule = normalizeDailySchedule(scheduleRow || null, defaultSchedule);
    } catch {
      schedule = normalizeDailySchedule(null, defaultSchedule);
    }

    const nowIso = new Date().toISOString();
    const livePureStudyMinutes = calculateLivePureStudyMinutes(session, nowIso, attendanceEvents, defaultSchedule.studyWindows);
    const liveAwayMinutes = calculateLiveAwayMinutes(session, nowIso);
    const dailyPointRows = await getDailyPointRows(supabase, student.id, session.session_date);
    const operatingRules = await getOperatingRules(supabase);

    const sessionForPreview = {
      ...session,
      pure_study_minutes: livePureStudyMinutes,
      away_count: awayCount,
      away_minutes: liveAwayMinutes,
      away_total_minutes_live: liveAwayMinutes,
      schedule_snapshot: schedule,
      students: undefined,
    };

    const shareLink = await ensureReportShareLink(supabase, request, {
      reportType: 'daily',
      reportId: report.id,
      createdBy: actorName,
    });

    const sendPayload = {
      channel: 'kakao',
      mode: 'live_webhook',
      isTest: false,
      actualSend: true,
      providerAdapterHint: 'KAKAO_PROVIDER_MODE와 KAKAO_FAIL_SAFE_MODE는 /api/kakao-send-webhook에서 최종 판단합니다.',
      recipientPhone,
      recipientPhones: recipients.map((item) => item.phoneDigits),
      recipients: recipients.map((item) => ({ name: item.name, relationship: item.relationship, phone: item.phoneDigits, isPrimary: item.isPrimary })),
      studentName: student.name,
      studentId: student.id,
      sessionId: session.id,
      reportId: report.id,
      idempotencyKey: `daily:${report.id}:${recipients.map((item) => item.phoneDigits).join(',') || 'no-recipient'}`,
      reportDate: session.session_date,
      scheduleSnapshot: schedule ? { plannedCheckIn: schedule.planned_check_in, plannedCheckOut: schedule.planned_check_out, isDefaultSchedule: Boolean(schedule.is_default_schedule) } : null,
      dailyIssueRules: operatingRules,
      defaultScheduleSnapshot: defaultSchedule,
      dailyPointRows,
      messageText: report.report_text,
      plannerImageUrl,
      hasPlannerImage: Boolean(plannerImageUrl),
      templateVariables: createDailyTemplateVariables({ student, session, report, awayCount, reportLink: shareLink.url, schedule, nowIso, events: attendanceEvents, pointRows: dailyPointRows, rules: operatingRules, defaultSchedule }),
      requestedBy: actorName,
      requestedByUserId: actor?.authType === 'app_user' ? actor.id : null,
      requestedByRole: actor?.role || null,
    };

    const templateValidation = validateKakaoTemplateVariables(sendPayload, 'daily');
    sendPayload.templateValidation = templateValidation;

    if (['prepare', 'send'].includes(action) && !shareLink.url) {
      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.failed',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          action,
          status: 'failed',
          reason: '공개 리포트 링크를 생성하지 못했습니다.',
          errorCode: 'PUBLIC_REPORT_LINK_MISSING',
          shareLinkError: shareLink.error || null,
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
        },
      });

      return Response.json({
        error: '공개 리포트 링크를 생성하지 못해 발송을 중단했습니다. v40-83 SQL 실행 여부와 PUBLIC_APP_URL 설정을 확인하세요.',
        code: 'PUBLIC_REPORT_LINK_MISSING',
        shareLinkError: shareLink.error || null,
      }, { status: 400 });
    }

    if (['prepare', 'send'].includes(action) && !templateValidation.ok) {
      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.failed',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          action,
          status: 'failed',
          reason: '카카오 템플릿 필수 변수가 누락되었습니다.',
          errorCode: 'KAKAO_TEMPLATE_VARIABLE_INVALID',
          templateValidation,
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
        },
      });

      return Response.json({
        error: `카카오 템플릿 필수 변수가 누락되었습니다: ${templateValidation.missing.join(', ')}`,
        code: 'KAKAO_TEMPLATE_VARIABLE_INVALID',
        templateValidation,
      }, { status: 400 });
    }

    if (action === 'preview') {
      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.preview',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
          shareLinkUrl: shareLink.url || null,
          shareLinkToken: shareLink.token || null,
          recipientCount: recipients.length,
        },
      });

      return Response.json({
        ok: true,
        mode: 'preview',
        sendPayload,
        report,
        session: sessionForPreview,
      });
    }

    if (!recipients.length) {
      const saved = await safeUpdateReport(
        supabase,
        report.id,
        {
          send_status: 'failed',
          sent_channel: 'kakao',
          send_error: '데일리 리포트 수신 보호자가 없습니다.',
          send_payload: sendPayload,
          parent_phone_snapshot: null,
          planner_image_url_snapshot: plannerImageUrl,
        },
        {
          send_status: 'failed',
          sent_channel: 'kakao',
        }
      );

      await safeInsertLog(supabase, {
        report_id: report.id,
        session_id: session.id,
        student_id: student.id,
        action,
        status: 'failed',
        recipient_phone: null,
        message_text: report.report_text,
        planner_image_url: plannerImageUrl,
        provider: 'kakao_pending',
        error_message: '학부모 연락처가 없습니다.',
        created_by: actorName,
      });

      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.failed',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          action,
          status: 'failed',
          reason: '데일리 리포트 수신 보호자가 없습니다.',
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
        },
      });

      return Response.json({ error: '학부모 연락처가 없습니다.', report: saved }, { status: 400 });
    }

    if (action === 'prepare') {
      const saved = await safeUpdateReport(
        supabase,
        report.id,
        {
          send_status: 'ready',
          sent_channel: 'kakao',
          send_error: null,
          send_payload: sendPayload,
          parent_phone_snapshot: recipients.map((item) => item.phoneDigits).join(','),
          planner_image_url_snapshot: plannerImageUrl,
        },
        {
          send_status: 'ready',
          sent_channel: 'kakao',
        }
      );

      await safeInsertLog(supabase, {
        report_id: report.id,
        session_id: session.id,
        student_id: student.id,
        action: 'prepare',
        status: 'ready',
        recipient_phone: recipients.map((item) => item.phoneDigits).join(','),
        message_text: report.report_text,
        planner_image_url: plannerImageUrl,
        provider: 'kakao_pending',
        created_by: actorName,
      });

      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.prepare',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          status: 'ready',
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
          shareLinkUrl: shareLink.url || null,
          shareLinkToken: shareLink.token || null,
          recipientPhones: recipients.map((item) => item.phoneDigits),
          idempotencyKey: sendPayload.idempotencyKey,
        },
      });

      return Response.json({
        ok: true,
        mode: 'prepare',
        report: saved,
        sendPayload,
        session: sessionForPreview,
        message: '발송대기 상태로 저장했습니다.',
      });
    }

    if (action === 'manual_sent') {
      const saved = await safeUpdateReport(
        supabase,
        report.id,
        {
          send_status: 'sent',
          sent_channel: 'manual_kakao_copy',
          sent_at: new Date().toISOString(),
          send_error: null,
          send_payload: sendPayload,
          parent_phone_snapshot: recipients.map((item) => item.phoneDigits).join(','),
          planner_image_url_snapshot: plannerImageUrl,
        },
        {
          send_status: 'sent',
          sent_channel: 'manual_kakao_copy',
        }
      );

      await safeInsertLog(supabase, {
        report_id: report.id,
        session_id: session.id,
        student_id: student.id,
        action: 'manual_sent',
        status: 'sent',
        recipient_phone: recipients.map((item) => item.phoneDigits).join(','),
        message_text: report.report_text,
        planner_image_url: plannerImageUrl,
        provider: 'manual_kakao_copy',
        created_by: actorName,
      });

      await writeUserActionLog(supabase, request, {
        actionType: 'daily_report.manual_sent',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          status: 'sent',
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
          shareLinkUrl: shareLink.url || null,
          shareLinkToken: shareLink.token || null,
          recipientPhones: recipients.map((item) => item.phoneDigits),
          idempotencyKey: sendPayload.idempotencyKey,
        },
      });

      return Response.json({
        ok: true,
        mode: 'manual_sent',
        report: saved,
        sendPayload,
        session: sessionForPreview,
        message: '수동 발송완료로 표시했습니다.',
      });
    }

    if (action === 'send') {
      const providerResult = await callWebhook(sendPayload);
      const sendStatus = providerResult.status || (providerResult.ok ? 'sent' : 'ready');
      const sentAt = providerResult.ok ? new Date().toISOString() : null;
      const errorMessage = providerResult.ok ? null : (providerResult.message || '카카오 발송 API 호출 실패 또는 미연동');

      const saved = await safeUpdateReport(
        supabase,
        report.id,
        {
          send_status: sendStatus,
          sent_channel: providerResult.provider || 'kakao',
          sent_at: sentAt,
          send_error: errorMessage,
          send_payload: sendPayload,
          parent_phone_snapshot: recipients.map((item) => item.phoneDigits).join(','),
          planner_image_url_snapshot: plannerImageUrl,
        },
        {
          send_status: sendStatus,
          sent_channel: providerResult.provider || 'kakao',
        }
      );

      await safeInsertLog(supabase, {
        report_id: report.id,
        session_id: session.id,
        student_id: student.id,
        action: 'send',
        status: sendStatus,
        recipient_phone: recipients.map((item) => item.phoneDigits).join(','),
        message_text: report.report_text,
        planner_image_url: plannerImageUrl,
        provider: providerResult.provider || 'kakao',
        provider_response: providerResult.response || providerResult,
        error_message: errorMessage,
        created_by: actorName,
      });

      await writeUserActionLog(supabase, request, {
        actionType: sendStatus === 'failed' ? 'daily_report.failed' : 'daily_report.send',
        targetType: 'daily_report',
        targetId: report.id,
        targetName: student.name,
        payload: {
          status: sendStatus,
          provider: providerResult.provider || 'kakao',
          providerStatus: providerResult.providerStatus || null,
          configured: providerResult.configured,
          requestId: providerResult.requestId || null,
          errorCode: providerResult.errorCode || null,
          studentId: student.id,
          sessionId: session.id,
          reportDate: session.session_date,
          shareLinkUrl: shareLink.url || null,
          shareLinkToken: shareLink.token || null,
          recipientPhones: recipients.map((item) => item.phoneDigits),
          recipientPolicy: providerResult.recipientPolicy || null,
          recipientResults: providerResult.recipientResults || [],
          recipientStats: providerResult.recipientStats || null,
          partialSuccess: Boolean(providerResult.partialSuccess || providerResult.recipientStats?.partialSuccess),
          errorMessage,
          idempotencyKey: sendPayload.idempotencyKey,
        },
      });

      return Response.json({
        ok: providerResult.ok,
        configured: providerResult.configured,
        mode: 'send',
        report: saved,
        sendPayload,
        session: sessionForPreview,
        providerResult,
        providerStatus: providerResult.providerStatus || null,
        requestId: providerResult.requestId || null,
        errorCode: providerResult.errorCode || null,
        message: providerResult.message || (providerResult.configured
          ? (providerResult.ok ? '카카오 발송 요청이 완료되었습니다.' : '카카오 발송 요청이 실패했습니다.')
          : '카카오 발송 API가 아직 연결되지 않아 발송대기 상태로 저장했습니다.'),
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
