import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { formatMinutes, getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

function formatKstDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
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
  } catch {}
  return null;
}

function timeToMinutes(value) {
  const raw = String(value || '').trim();
  if (raw === '24:00') return 24 * 60;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getCheckPeriodMeta(check = {}, defaultSchedule = {}) {
  const checkedMinute = getKstMinutesFromIso(check.checked_at);
  const windows = Array.isArray(defaultSchedule?.studyWindows) ? defaultSchedule.studyWindows : [];
  if (checkedMinute !== null) {
    const matched = windows
      .map((item, index) => ({
        ...item,
        index,
        startMinute: timeToMinutes(item.start),
        endMinute: timeToMinutes(item.end),
      }))
      .find((item) => item.startMinute !== null && item.endMinute !== null && checkedMinute >= item.startMinute && checkedMinute < item.endMinute);

    if (matched) {
      return {
        key: `${matched.label || matched.index}-${matched.start}-${matched.end}`,
        sortMinute: matched.startMinute,
        label: matched.label || `${matched.index + 1}차시`,
        range: `${matched.start}~${matched.end}`,
        periodText: `${matched.label || `${matched.index + 1}차시`} ${matched.start}~${matched.end}`,
        checkedAtText: formatKstDateTime(check.checked_at),
      };
    }
  }

  const fallbackTime = formatKstDateTime(check.checked_at);
  return {
    key: `check-${check.id || check.checked_at || Math.random()}`,
    sortMinute: checkedMinute ?? 9999,
    label: '순찰 체크',
    range: fallbackTime,
    periodText: `${fallbackTime} 순찰 체크`,
    checkedAtText: fallbackTime,
  };
}

function formatChecksBySchedulePeriod(checks = [], defaultSchedule = {}) {
  if (!(checks || []).length) return '순찰 체크 기록이 아직 없습니다.';

  const groups = new Map();
  for (const check of checks || []) {
    const meta = getCheckPeriodMeta(check, defaultSchedule);
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, checks: [] });
    groups.get(meta.key).checks.push(check);
  }

  return [...groups.values()]
    .sort((a, b) => a.sortMinute - b.sortMinute)
    .map((group, index) => {
      const sortedChecks = [...group.checks].sort((a, b) => new Date(a.checked_at || 0) - new Date(b.checked_at || 0));
      const statusSummary = [...new Set(sortedChecks.map((check) => [check.subject, check.study_status].filter(Boolean).join(' / ')).filter(Boolean))].join(' → ') || '학습 상태 미입력';
      const contentSummary = [...new Set(sortedChecks.map((check) => String(check.study_content || '').trim()).filter(Boolean))].join(' / ') || '학습 내용 및 특이사항 미입력';
      const checkedTimes = sortedChecks.map((check) => formatKstDateTime(check.checked_at)).filter((value) => value && value !== '-');
      const checkedNote = checkedTimes.length ? `체크 ${checkedTimes.join(', ')}` : '체크 시간 확인 불가';
      return `${index + 1}. ${group.periodText} - ${statusSummary}\n  · ${contentSummary}\n  · ${checkedNote}`;
    })
    .join('\n');
}

function calculateCurrentAwayMinutes(session) {
  if (!session.away_started_at) return 0;
  return diffMinutes(session.away_started_at, new Date().toISOString());
}

function calculateTotalAwayMinutes(session) {
  return Number(session.away_total_minutes || 0) + calculateCurrentAwayMinutes(session);
}

function calculateReportPureStudyMinutes(session, events = [], studyWindows = undefined) {
  return calculateScheduledPureStudyMinutes(session, { events, studyWindows });
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

async function getStudentPoints(supabase, studentId, startDate, endDate = startDate) {
  try {
    const { data } = await supabase
      .from('student_points')
      .select('*')
      .eq('student_id', String(studentId))
      .eq('is_deleted', false)
      .gte('point_date', startDate)
      .lte('point_date', endDate)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false });
    return data || [];
  } catch {
    return [];
  }
}

function formatPointSummary(rows = []) {
  const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  if (!rows.length) return '상벌점: 기록 없음';
  const details = rows.slice(0, 4).map((row) => `${row.point_type === 'reward' ? '상점' : '벌점'} ${row.points}점(${row.reason || '-'})`).join(', ');
  return `상벌점: 상점 ${reward}점 / 벌점 ${penalty}점${details ? ` · ${details}` : ''}`;
}

function getExitLabel(session, events = []) {
  if (session.check_out_at) return formatKstDateTime(session.check_out_at);

  if (session.seat_status === 'absent') return formatIssueWithReason('결석', getEventReason(events, 'absent', '결석'));
  if (session.seat_status === 'not_arrived') return '미입실';
  if (session.seat_status === 'away') return '외출중';
  if (session.seat_status === 'needs_attention') return '관리필요';

  return '아직 학습중';
}

function isStillStudying(session) {
  return Boolean(
    !session.check_out_at
      && session.check_in_at
      && ['occupied', 'away', 'needs_attention'].includes(session.seat_status)
  );
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);

    if (!body.sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .eq('id', body.sessionId)
      .single();

    if (sessionError) throw sessionError;

    const defaultSchedule = resolveScheduleForDate(scheduleConfig, session.session_date);

    const { data: checks, error: checksError } = await supabase
      .from('study_checks')
      .select('*')
      .eq('session_id', body.sessionId)
      .order('checked_at', { ascending: true });

    if (checksError) throw checksError;

    const { data: events, error: eventsError } = await supabase
      .from('attendance_events')
      .select('*')
      .eq('session_id', body.sessionId);

    if (eventsError) throw eventsError;

    let plannerLabel = '플래너: 미업로드';
    let plannerImageUrl = null;
    let plannerFileName = null;
    try {
      const { data: planner } = await supabase
        .from('planner_photos')
        .select('*')
        .eq('student_id', session.student_id)
        .eq('planner_date', session.session_date)
        .maybeSingle();

      if (planner?.id) {
        plannerFileName = planner.file_name || null;
        plannerLabel = `플래너: 업로드 완료${planner.memo ? ` (${planner.memo})` : ''} · 이미지 별도 첨부`;
        const plannerPath = planner.file_path || planner.photo_url;
        if (plannerPath) {
          const { data: signed } = await supabase.storage
            .from('planner-photos')
            .createSignedUrl(plannerPath, 60 * 60 * 6);
          plannerImageUrl = signed?.signedUrl || null;
        }
      }
    } catch {
      plannerLabel = '플래너: 확인 불가';
    }

    const student = session.students;
    const awayEvents = (events || []).filter((event) => event.event_type === 'away');
    const awayCount = awayEvents.length;
    const awayDetails = [...new Set(awayEvents.map((event) => String(event.memo || '').trim()).filter(Boolean))];
    const awayLine = awayDetails.length
      ? `외출: 총 ${formatMinutes(calculateTotalAwayMinutes(session))}, ${awayCount}회, ${awayDetails.join(', ')}`
      : `외출: 총 ${formatMinutes(calculateTotalAwayMinutes(session))}, ${awayCount}회`;

    const { data: existingReport } = await supabase
      .from('daily_reports')
      .select('*')
      .eq('session_id', body.sessionId)
      .maybeSingle();

    const checksText = formatChecksBySchedulePeriod(checks || [], defaultSchedule);

    const mentorComment = (String(body.mentorComment || '').trim() || String(existingReport?.mentor_comment || '').trim());
    const reportPureStudyMinutes = calculateReportPureStudyMinutes(session, events, defaultSchedule.studyWindows);
    const exitLabel = getExitLabel(session, events);
    const attendanceMemoLabel = session.seat_status === 'absent'
      ? formatIssueWithReason('결석', getEventReason(events, 'absent', '결석'))
      : (session.attendance_memo || '-');
    const pureStudyLabel = `${formatMinutes(reportPureStudyMinutes)}${isStillStudying(session) ? ' (계속 학습중)' : ''}`;
    const mentorBlock = mentorComment ? `\n\n학습멘토 코멘트\n${mentorComment}` : '';
    const pointRows = await getStudentPoints(supabase, student.id, session.session_date || getKstDateString());
    const pointLine = formatPointSummary(pointRows);

    const reportText = `[비욘드 데일리 리포트]\n\n학생: ${student.name}\n학교/학년: ${[student.school, student.grade].filter(Boolean).join(' ') || '-'}\n좌석: ${String(session.seat_no).padStart(2, '0')}번\n날짜: ${session.session_date || getKstDateString()}\n입실: ${formatKstDateTime(session.check_in_at)}\n퇴실: ${exitLabel}\n${awayLine}\n순공시간: ${pureStudyLabel}\n${plannerLabel}\n특이사항: ${attendanceMemoLabel || '-'}\n${pointLine}\n\n오늘의 학습 기록\n${checksText}${mentorBlock}`;

    const { data: report, error: reportError } = await supabase
      .from('daily_reports')
      .upsert({
        session_id: session.id,
        student_id: student.id,
        report_date: session.session_date,
        report_text: reportText,
        mentor_comment: mentorComment || null,
        send_status: 'draft',
        sent_channel: 'kakao_copy',
        created_by: body.adminName || '관리자',
      }, { onConflict: 'session_id' })
      .select()
      .single();

    if (reportError) throw reportError;

    return Response.json({ report, reportText, plannerImageUrl, plannerFileName, plannerImageAvailable: Boolean(plannerImageUrl) });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
