import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getKstDateString } from '../../../lib/date';
import { getReportSendSettings, normalizeAttendanceNotificationSettings } from '../../../lib/reportSendSettings';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const kioskSecret = String(process.env.KIOSK_BRIDGE_SECRET || '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const incomingKioskSecret = String(request.headers.get('x-kiosk-secret') || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (kioskSecret && incomingKioskSecret === kioskSecret) return true;
  if (cronSecret && bearerToken === cronSecret) return true;

  // 로컬/프리뷰에서 아직 비밀키가 설정되지 않은 경우만 허용합니다.
  // Production에서는 KIOSK_BRIDGE_SECRET을 반드시 설정하는 것을 권장합니다.
  if (!kioskSecret && !cronSecret) return true;
  return false;
}

function unauthorizedResponse() {
  return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}


function timeToMinutes(value) {
  if (!value) return null;
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + Number(minutes || 0) * 60000).toISOString();
}

function timeToKstIso(dateString, timeValue) {
  const text = String(timeValue || '').slice(0, 5);
  if (text === '24:00') {
    const d = new Date(`${dateString}T00:00:00+09:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return new Date(`${dateString}T${text}:00+09:00`).toISOString();
}

function getKstMinuteOfDay(value) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(value));
    let hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    if (hour === 24) hour = 0;
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function findMatchingBreak(breaks = [], awayStartedAt) {
  const awayMinute = getKstMinuteOfDay(awayStartedAt);
  if (awayMinute === null) return null;
  const valid = (breaks || [])
    .map((item) => ({
      ...item,
      leaveMinute: timeToMinutes(item.leave_start),
      returnMinute: timeToMinutes(item.return_time),
    }))
    .filter((item) => item.leaveMinute !== null && item.returnMinute !== null && item.returnMinute > item.leaveMinute);

  const containing = valid
    .filter((item) => item.leaveMinute <= awayMinute + 10 && item.returnMinute >= awayMinute)
    .sort((a, b) => Math.abs(a.leaveMinute - awayMinute) - Math.abs(b.leaveMinute - awayMinute));
  if (containing[0]) return containing[0];

  const near = valid
    .filter((item) => Math.abs(item.leaveMinute - awayMinute) <= 30)
    .sort((a, b) => Math.abs(a.leaveMinute - awayMinute) - Math.abs(b.leaveMinute - awayMinute));
  return near[0] || null;
}

async function getScheduleBreaksForSession(supabase, session) {
  const { data: schedule, error: scheduleError } = await supabase
    .from('student_daily_schedules')
    .select('*')
    .eq('student_id', session.student_id)
    .eq('schedule_date', session.session_date)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  if (!schedule?.id) return [];

  const { data: breaks, error: breaksError } = await supabase
    .from('student_schedule_breaks')
    .select('*')
    .eq('schedule_id', schedule.id)
    .order('leave_start', { ascending: true });
  if (breaksError) throw breaksError;
  return breaks || [];
}

async function getLatestAwayEvent(supabase, session) {
  const { data, error } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('session_id', session.id)
    .eq('event_type', 'away')
    .order('event_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function runReturnOverdueCheck(request) {
  const supabase = getSupabaseAdmin();
  const settingsResult = await getReportSendSettings(supabase);
  const notificationSettings = normalizeAttendanceNotificationSettings(settingsResult.settings?.attendanceNotifications || {});
  if (!notificationSettings.returnOverdueEnabled) {
    return { ok: true, skipped: true, reason: 'return_overdue_disabled', checked: 0, notified: 0, results: [] };
  }

  const today = getKstDateString();
  const nowIso = new Date().toISOString();
  const graceMinutes = notificationSettings.returnOverdueGraceMinutes;

  const { data: sessions, error } = await supabase
    .from('daily_sessions')
    .select('*, students(*)')
    .eq('session_date', today)
    .eq('seat_status', 'away')
    .not('check_in_at', 'is', null)
    .is('check_out_at', null)
    .not('away_started_at', 'is', null)
    .order('away_started_at', { ascending: true });
  if (error) throw error;

  const results = [];
  let notified = 0;

  for (const session of sessions || []) {
    try {
      const breaks = await getScheduleBreaksForSession(supabase, session);
      const matchedBreak = findMatchingBreak(breaks, session.away_started_at);
      if (!matchedBreak?.return_time) {
        results.push({ sessionId: session.id, studentName: session.students?.name, skipped: true, reason: 'matching_schedule_break_missing' });
        continue;
      }

      const expectedReturnAt = timeToKstIso(session.session_date, matchedBreak.return_time);
      const notifyAfter = addMinutes(expectedReturnAt, graceMinutes);
      if (new Date(nowIso).getTime() < new Date(notifyAfter).getTime()) {
        results.push({ sessionId: session.id, studentName: session.students?.name, skipped: true, reason: 'not_overdue_yet', expectedReturnAt, notifyAfter });
        continue;
      }

      const latestAwayEvent = await getLatestAwayEvent(supabase, session);
      const sourceType = latestAwayEvent?.source_type || 'manual';
      const sourceLabel = latestAwayEvent?.source_label || (sourceType === 'kiosk' ? '키오스크 자동기록' : '관리자 수동기록');
      const notification = await sendAttendanceNotification({
        supabase,
        request,
        attendanceEvent: latestAwayEvent || {
          session_id: session.id,
          student_id: session.student_id,
          event_type: 'away',
          event_at: session.away_started_at,
          source_type: sourceType,
          source_label: sourceLabel,
        },
        session,
        student: session.students || null,
        sourceType,
        sourceLabel,
        createdBy: 'system:return_overdue_check',
        notificationType: 'return_overdue',
        notificationMeta: {
          eventAt: expectedReturnAt,
          expectedReturnAt,
          awayStartedAt: session.away_started_at,
          graceMinutes,
          scheduleBreakId: matchedBreak.id,
          checkRanAt: nowIso,
        },
      });

      if (notification?.ok && !notification?.skipped) notified += 1;
      results.push({ sessionId: session.id, studentName: session.students?.name, expectedReturnAt, notifyAfter, notification });
    } catch (itemError) {
      results.push({ sessionId: session.id, studentName: session.students?.name, error: itemError.message || String(itemError) });
    }
  }

  return {
    ok: true,
    checked: sessions?.length || 0,
    notified,
    graceMinutes,
    now: nowIso,
    results,
  };
}

export async function GET(request) {
  try {
    if (!isAuthorized(request)) return unauthorizedResponse();
    const result = await runReturnOverdueCheck(request);
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: error.message || '복귀 지연 알림 점검 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
