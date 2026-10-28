// Beyond OS v41-275
// 자율학습 중 장시간 외출 — 다음 날 벌점 확인 명단
//
// GET  ?date=YYYY-MM-DD   그날의 후보(외출→복귀 닫힌 구간, 자율학습 겹침 ≥ 기준) + 이미 내린 결정
// POST { action: 'penalty' | 'skip' | 'undo', candidate, note }
//   penalty : 벌점(기본 3점)을 student_points 에 넣고 결정을 기록
//   skip    : 사유가 있어 제외했다고만 기록
//   undo    : 결정을 지웁니다. 벌점이 있었으면 그 벌점도 삭제 처리합니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { selectInChunks } from '../../../lib/supabaseChunk';
import { getKstDateString } from '../../../lib/date';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';
import { getPointAutoRules } from '../../../lib/pointAutoRulesServer';
import { findLongAwayCandidates, buildLongAwayPenaltyReason, previousDateString, LONG_AWAY_SQL_HINT } from '../../../lib/longAwayReview';
import { loadPointTotals } from '../../../lib/pointTotals';
import { sendPointSlackNotice } from '../../../lib/slackNotify';
import { loadCohortRange, getCohortIdFromRequest } from '../../../lib/cohortScope';

export const dynamic = 'force-dynamic';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function isMissingTable(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || message.includes('long_away_reviews') || message.includes('does not exist') || message.includes('schema cache');
}

async function loadReviews(supabase, date) {
  try {
    const { data, error } = await supabase
      .from('long_away_reviews')
      .select('*')
      .eq('session_date', date);
    if (error) throw error;
    return { rows: data || [], warning: '' };
  } catch (error) {
    if (isMissingTable(error)) return { rows: [], warning: `결정 기록 표가 아직 없습니다. ${LONG_AWAY_SQL_HINT}`, missingTable: true };
    throw error;
  }
}

async function buildCandidates(supabase, date, rules) {
  const scheduleConfig = await getDefaultScheduleConfig(supabase);
  const dayInfo = resolveScheduleForDate(scheduleConfig, date);

  const { data: sessions, error: sessionError } = await supabase
    .from('daily_sessions')
    .select('id, student_id, session_date, check_in_at, check_out_at, seat_status, students(id, name, school, grade, status)')
    .eq('session_date', date);
  if (sessionError) throw sessionError;

  const live = (sessions || []).filter((row) => row.students?.status !== 'inactive');
  const sessionIds = live.map((row) => row.id);
  const events = sessionIds.length
    ? await selectInChunks(sessionIds, (part) => supabase
      .from('attendance_events')
      .select('id, session_id, event_type, event_at, created_at, memo')
      .in('session_id', part))
    : [];
  const eventsBySession = {};
  for (const event of events || []) {
    const key = String(event.session_id);
    if (!eventsBySession[key]) eventsBySession[key] = [];
    eventsBySession[key].push(event);
  }

  // 그날 시간표에 잡힌 외출 (사유 참고용)
  const breaksByStudent = {};
  try {
    const studentIds = [...new Set(live.map((row) => String(row.student_id)))];
    if (studentIds.length) {
      const schedules = await selectInChunks(studentIds, (part) => supabase
        .from('student_daily_schedules')
        .select('id, student_id')
        .eq('schedule_date', date)
        .in('student_id', part));
      const scheduleIds = (schedules || []).map((row) => row.id);
      const studentBySchedule = Object.fromEntries((schedules || []).map((row) => [String(row.id), String(row.student_id)]));
      const breaks = scheduleIds.length
        ? await selectInChunks(scheduleIds, (part) => supabase
          .from('student_schedule_breaks')
          .select('schedule_id, leave_start, return_time, reason, reason_detail')
          .in('schedule_id', part))
        : [];
      for (const item of breaks || []) {
        const sid = studentBySchedule[String(item.schedule_id)];
        if (!sid) continue;
        if (!breaksByStudent[sid]) breaksByStudent[sid] = [];
        breaksByStudent[sid].push(item);
      }
    }
  } catch {
    // 시간표 외출을 못 읽어도 명단은 만듭니다. (참고 정보일 뿐입니다)
  }

  return {
    dayInfo,
    ...findLongAwayCandidates({
      date,
      // v41-275.1: 자율학습 구간은 그 날짜의 기수별 기본 시간표에서 가져옵니다.
      dayInfo,
      dayType: dayInfo.dayType,
      sessions: live,
      eventsBySession,
      breaksByStudent,
      thresholdMinutes: rules.longAwayMinutes,
    }),
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const today = getKstDateString();
    const date = toDate(searchParams.get('date')) || previousDateString(today);
    const rules = await getPointAutoRules(supabase);

    const [built, reviews] = await Promise.all([
      buildCandidates(supabase, date, rules),
      loadReviews(supabase, date),
    ]);
    const reviewByEvent = Object.fromEntries(reviews.rows.map((row) => [String(row.away_event_id), row]));
    const candidates = built.candidates.map((item) => {
      const review = reviewByEvent[item.awayEventId] || null;
      return {
        ...item,
        decision: review ? review.decision : null,
        decidedBy: review?.decided_by || '',
        decidedAt: review?.decided_at || null,
        decidedPoints: review?.points || 0,
        decidedNote: review?.note || '',
        reviewId: review?.id || null,
        pointId: review?.point_id || null,
      };
    });

    return Response.json({
      date,
      today,
      enabled: rules.longAwayPenaltyEnabled !== false,
      thresholdMinutes: rules.longAwayMinutes,
      points: rules.longAwayPoints,
      dayType: built.dayInfo.dayType,
      operating: built.dayInfo.operating,
      selfStudyLabel: built.selfStudyLabel,
      selfStudySource: built.selfStudySource || '',
      candidates,
      pendingCount: candidates.filter((item) => !item.decision).length,
      warning: reviews.warning || (built.reason === 'no_self_study'
        ? (built.dayInfo.operating === false ? '이 날은 휴무일인데 기본 시간표에 공부 인정 구간이 없습니다. 설정 › 기본 시간표의 해당 요일 유형에 인정 구간을 넣으면 그 전체를 자율학습으로 봅니다.' : '이 날짜의 기본 시간표에 자율학습 차시가 없습니다. 설정 › 기본 시간표에서 "자율학습" 차시를 추가하세요.')
        : ''),
      missingTable: Boolean(reviews.missingTable),
    });
  } catch (error) {
    return Response.json({ error: error.message || '장시간 외출 명단 조회 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;
  try {
    const body = await request.json();
    const action = String(body.action || '');
    const candidate = body.candidate && typeof body.candidate === 'object' ? body.candidate : null;
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';
    const rules = await getPointAutoRules(supabase);

    if (!candidate || !candidate.studentId || !candidate.awayEventId || !toDate(candidate.sessionDate)) {
      return Response.json({ error: '대상 정보가 부족합니다. 명단을 새로고침한 뒤 다시 시도하세요.' }, { status: 400 });
    }
    const note = String(body.note || '').trim().slice(0, 300);
    const sessionDate = toDate(candidate.sessionDate);

    if (action === 'undo') {
      const { data: existing, error: findError } = await supabase
        .from('long_away_reviews')
        .select('*')
        .eq('away_event_id', String(candidate.awayEventId))
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) return Response.json({ ok: true, message: '이미 결정이 없는 건입니다.' });
      if (existing.point_id) {
        await supabase
          .from('student_points')
          .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: actorName })
          .eq('id', existing.point_id);
      }
      const { error: delError } = await supabase.from('long_away_reviews').delete().eq('id', existing.id);
      if (delError) throw delError;
      await writeUserActionLog(supabase, request, {
        actionType: 'long_away.undo',
        targetType: 'long_away_review',
        targetId: existing.id,
        targetName: candidate.name || candidate.studentId,
        payload: { studentId: candidate.studentId, sessionDate, awayEventId: candidate.awayEventId, hadPoint: Boolean(existing.point_id) },
      });
      return Response.json({ ok: true, message: existing.point_id ? '결정을 되돌리고 벌점을 삭제했습니다.' : '결정을 되돌렸습니다.' });
    }

    if (action !== 'penalty' && action !== 'skip') {
      return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
    }

    // 같은 건에 이미 결정이 있으면 막습니다. (두 번 벌점이 들어가지 않도록)
    const { data: existing, error: existError } = await supabase
      .from('long_away_reviews')
      .select('id, decision')
      .eq('away_event_id', String(candidate.awayEventId))
      .maybeSingle();
    if (existError) {
      if (isMissingTable(existError)) return Response.json({ error: `결정 기록 표가 없습니다. ${LONG_AWAY_SQL_HINT}` }, { status: 400 });
      throw existError;
    }
    if (existing) return Response.json({ error: `이미 ${existing.decision === 'penalty' ? '벌점 부여' : '제외'}로 처리된 건입니다. 바꾸려면 먼저 [되돌리기]를 누르세요.` }, { status: 409 });

    let pointId = null;
    const points = action === 'penalty' ? rules.longAwayPoints : 0;
    if (action === 'penalty') {
      const { data: point, error: pointError } = await supabase
        .from('student_points')
        .insert({
          student_id: String(candidate.studentId),
          point_date: sessionDate,
          point_type: 'penalty',
          points,
          reason: buildLongAwayPenaltyReason({
            awayMinutes: Number(candidate.awayMinutes || 0),
            awayLabel: String(candidate.awayLabel || ''),
          }),
          memo: note || null,
          created_by: actorName,
          is_deleted: false,
        })
        .select()
        .single();
      if (pointError) throw pointError;
      pointId = point.id;
      // v41-280: 슬랙 알림 (카테고리 '자율학습 중 장시간 외출')
      try {
        const range = await loadCohortRange(supabase, getCohortIdFromRequest(request), getKstDateString()).catch(() => null);
        const totals = await loadPointTotals(supabase, String(candidate.studentId), range);
        await sendPointSlackNotice({
          studentName: candidate.name || '학생', pointType: 'penalty', points,
          category: '자율학습 중 장시간 외출', detail: `${candidate.awayLabel || ''} ${candidate.awayMinutes || 0}분${note ? ` · ${note}` : ''}`.trim(),
          totals, actorName, pointDate: sessionDate,
        });
      } catch { /* 알림 실패는 벌점 기록을 막지 않습니다 */ }
    }

    const { data: review, error: reviewError } = await supabase
      .from('long_away_reviews')
      .insert({
        student_id: String(candidate.studentId),
        session_date: sessionDate,
        session_id: candidate.sessionId || null,
        away_event_id: String(candidate.awayEventId),
        return_event_id: candidate.returnEventId ? String(candidate.returnEventId) : null,
        away_started_at: candidate.awayStartedAt || null,
        returned_at: candidate.returnedAt || null,
        away_minutes: Number(candidate.awayMinutes || 0),
        self_study_minutes: Number(candidate.selfStudyMinutes || 0),
        decision: action,
        points,
        note: note || null,
        point_id: pointId,
        decided_by: actorName,
        decided_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (reviewError) {
      // 결정 기록에 실패하면 방금 넣은 벌점도 거둡니다. (명단에 다시 떠야 하므로)
      if (pointId) await supabase.from('student_points').delete().eq('id', pointId);
      throw reviewError;
    }

    await writeUserActionLog(supabase, request, {
      actionType: action === 'penalty' ? 'long_away.penalty' : 'long_away.skip',
      targetType: 'long_away_review',
      targetId: review.id,
      targetName: candidate.name || candidate.studentId,
      payload: { studentId: candidate.studentId, sessionDate, awayEventId: candidate.awayEventId, awayMinutes: candidate.awayMinutes, selfStudyMinutes: candidate.selfStudyMinutes, points, note, pointId },
    });

    return Response.json({
      ok: true,
      review,
      message: action === 'penalty'
        ? `${candidate.name || '학생'} 벌점 ${points}점 기록 완료 (장시간 외출 ${candidate.awayMinutes}분)`
        : `${candidate.name || '학생'} 건을 사유 있음으로 제외했습니다.`,
    });
  } catch (error) {
    return Response.json({ error: `${error.message || '처리 실패'}${isMissingTable(error) ? ` / ${LONG_AWAY_SQL_HINT}` : ''}` }, { status: 500 });
  }
}
