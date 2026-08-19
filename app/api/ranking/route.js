import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';
import { loadCohortContext, resolveStudentCohortRange, sortCohorts, isUsableCohort } from '../../../lib/cohorts';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const scheduleConfig = await getDefaultScheduleConfig(supabase);
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const requestedCohortId = String(searchParams.get('cohortId') || '').trim();

    // v41-148: 기수를 지정하면 그 기수의 기간·명단으로 랭킹을 분리합니다.
    // '연속' 정책일 때는 두 기수를 모두 수강한 학생만 이전 기수부터 이어서 집계하므로,
    // 학생마다 집계 구간이 달라질 수 있어 아래에서 학생별로 판정합니다.
    let cohortContext = null;
    let cohort = null;
    let cohortWarning = '';
    if (requestedCohortId) {
      cohortContext = await loadCohortContext(supabase);
      cohortWarning = cohortContext.warning;
      cohort = sortCohorts(cohortContext.cohorts).find((item) => String(item.id) === requestedCohortId) || null;
      if (cohort && !isUsableCohort(cohort)) cohort = null;
      if (requestedCohortId && !cohort && !cohortWarning) {
        cohortWarning = '선택한 기수를 찾지 못해 전체 기간으로 조회했습니다.';
      }
    }

    const rosterSet = cohort ? (cohortContext.rosterByCohort[String(cohort.id)] || new Set()) : null;

    // 학생별 집계 구간을 미리 계산합니다. (분리 정책이면 모두 동일)
    const rangeByStudent = {};
    const requestedStart = searchParams.get('start') || today;
    const requestedEnd = searchParams.get('end') || today;
    // v41-171: keepRange=1 이면 기수는 '명단을 좁히는 용도'로만 쓰고,
    // 집계 기간은 화면에서 고른 시작일~종료일을 그대로 씁니다.
    // (기수를 고르면 기간이 기수 전체로 덮여, 오늘/이번 주 같은 기간 선택이 먹히지 않았습니다)
    const keepRange = searchParams.get('keepRange') === '1';
    let start = requestedStart;
    let end = requestedEnd;
    if (cohort) {
      let minStart = cohort.startDate;
      for (const studentId of rosterSet) {
        const range = resolveStudentCohortRange(
          cohort,
          cohortContext.cohorts,
          cohortContext.cohortIdsByStudent[String(studentId)] || new Set(),
          cohortContext.settings,
        );
        if (!range) continue;
        rangeByStudent[String(studentId)] = range;
        if (range.start < minStart) minStart = range.start;
      }
      if (keepRange) {
        // 학생별 기수 구간과 요청 기간이 겹치는 부분만 집계합니다.
        for (const key of Object.keys(rangeByStudent)) {
          const range = rangeByStudent[key];
          rangeByStudent[key] = {
            start: range.start > requestedStart ? range.start : requestedStart,
            end: range.end < requestedEnd ? range.end : requestedEnd,
          };
        }
      } else {
        // 조회는 가장 넓은 구간으로 한 번만 하고, 합산할 때 학생별 구간으로 거릅니다.
        start = minStart;
        end = cohort.endDate;
      }
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from('daily_sessions')
      .select('*, students(*)')
      .gte('session_date', start)
      .lte('session_date', end);

    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions || []).map((session) => session.id);
    let events = [];

    // v41-210: 세션 id 를 한 번에 in(...) 으로 넘기면 조회 주소가 너무 길어져
    // 게이트웨이가 400(Bad Request)으로 끊습니다.
    // 월간(최근 30일 × 26명 = 780건)이면 주소만 28KB가 넘습니다. 나눠서 조회합니다.
    const EVENT_ID_CHUNK = 120;
    for (let index = 0; index < sessionIds.length; index += EVENT_ID_CHUNK) {
      const part = sessionIds.slice(index, index + EVENT_ID_CHUNK);
      if (!part.length) continue;
      const { data: eventRows, error: eventsError } = await supabase
        .from('attendance_events')
        .select('*')
        .in('session_id', part);

      if (eventsError) throw eventsError;
      events.push(...(eventRows || []));
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
      // 기수를 지정하면 그 기수 명단에 있는 학생만 랭킹에 올립니다.
      if (rosterSet && !rosterSet.has(String(student.id))) continue;
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
      // 연속 정책에서는 학생마다 집계 시작일이 다를 수 있어 여기서 한 번 더 거릅니다.
      const studentRange = rangeByStudent[String(session.student_id)];
      if (studentRange) {
        const date = String(session.session_date || '');
        if (date < studentRange.start || date > studentRange.end) continue;
        if (studentRange.continued) row.continuedFromPreviousCohort = true;
      }
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

    return Response.json({
      start,
      end,
      ranking,
      cohort: cohort ? { id: cohort.id, name: cohort.name, startDate: cohort.startDate, endDate: cohort.endDate } : null,
      cohortPolicy: cohortContext ? cohortContext.settings : null,
      warning: cohortWarning || undefined,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
