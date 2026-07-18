import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const start = searchParams.get('start') || today;
    const end = searchParams.get('end') || today;

    const { data: sessions, error: sessionsError } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .gte('session_date', start)
      .lte('session_date', end);

    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions || []).map((session) => session.id);
    let events = [];

    if (sessionIds.length) {
      const { data: eventRows, error: eventsError } = await supabase
        .from('attendance_events')
        .select('*')
        .in('session_id', sessionIds);

      if (eventsError) throw eventsError;
      events = eventRows || [];
    }

    const eventsBySession = {};
    for (const event of events || []) {
      if (!eventsBySession[event.session_id]) eventsBySession[event.session_id] = [];
      eventsBySession[event.session_id].push(event);
    }

    // 1) 활성 학생 전체를 먼저 시드합니다 → 순공시간이 0이어도 랭킹 리스트에 전부 포함.
    //    비활성 학생은 애초에 시드하지 않으므로 랭킹에서 즉시 제외됩니다.
    const { data: activeStudents, error: studentsError } = await supabase
      .from('students')
      .select('id, name, school, grade, nickname, ranking_opt_in')
      .eq('status', 'active');
    if (studentsError) throw studentsError;

    const map = {};
    for (const student of activeStudents || []) {
      map[student.id] = {
        studentId: student.id,
        name: student.name,
        school: student.school,
        grade: student.grade,
        nickname: student.nickname || null,
        rankingOptIn: Boolean(student.ranking_opt_in),
        attendanceDays: 0,
        totalStudyMinutes: 0,
        awayCount: 0,
        awayMinutes: 0,
        needsAttentionCount: 0,
        absentCount: 0,
      };
    }

    // 2) 세션 누적 — 활성 학생(시드된)만 반영. 비활성/삭제 학생 세션은 건너뜁니다.
    for (const session of sessions || []) {
      const row = map[session.student_id];
      if (!row) continue;
      row.attendanceDays += session.check_in_at ? 1 : 0;
      row.totalStudyMinutes += calculateScheduledPureStudyMinutes(session, { events: eventsBySession[session.id] || [], studyWindows: resolveScheduleForDate(scheduleConfig, session.session_date).studyWindows });
      row.needsAttentionCount += session.seat_status === 'needs_attention' ? 1 : 0;
      row.absentCount += session.seat_status === 'absent' ? 1 : 0;
      row.awayCount += (eventsBySession[session.id] || []).filter((event) => event.event_type === 'away').length;
      // 집중력 랭킹용 외출 누적 시간(분): 저장된 누적 + 미복귀(열린) 외출 구간
      row.awayMinutes += Number(session.away_total_minutes || 0)
        + (session.away_started_at && !session.check_out_at ? diffMinutes(session.away_started_at, new Date().toISOString()) : 0);
    }

    const ranking = Object.values(map)
      .map((row) => ({
        ...row,
        averageStudyMinutes: row.attendanceDays ? Math.round(row.totalStudyMinutes / row.attendanceDays) : 0,
      }))
      .sort((a, b) => b.totalStudyMinutes - a.totalStudyMinutes);

    return Response.json({ start, end, ranking });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
