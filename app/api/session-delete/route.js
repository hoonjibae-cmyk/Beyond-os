// Beyond OS v41-279 — 그날 출결 기록 전체 삭제 (미입실로 되돌리기)
//
// daily_sessions 한 행과 그에 매달린 attendance_events · study_checks 를 지웁니다.
// report_send_logs / report_send_exclusions 는 DB 의 on delete cascade 로 함께 지워지고,
// 알림톡 발송 로그 · 키오스크 수신 기록 · 플래너 사진은 연결만 끊깁니다(on delete set null).
// confirm:true 가 아니면 지우지 않고 요약·영향만 돌려줍니다. 지운 내용은 활동 로그에 통째로 남깁니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { describeSessionDeletion } from '../../../lib/attendanceEventTime';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  // v41-279.1: 총괄관리자(설정 권한)만 지울 수 있습니다. 화면 버튼도 같은 기준으로 숨깁니다.
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;
  try {
    const body = await request.json();
    const sessionId = String(body.sessionId || '').trim();
    const confirmed = body.confirm === true;
    if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const { data: session, error: sessionError } = await supabase
      .from('daily_sessions')
      .select('*, students(id, name, school, grade)')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return Response.json({ error: '이미 삭제됐거나 없는 출결 기록입니다. 화면을 새로고침하세요.' }, { status: 404 });

    const { data: events, error: eventsError } = await supabase.from('attendance_events').select('*').eq('session_id', sessionId);
    if (eventsError) throw eventsError;
    let checks = [];
    try {
      const { data } = await supabase.from('study_checks').select('*').eq('session_id', sessionId);
      checks = data || [];
    } catch {
      checks = [];
    }

    const defaultSchedule = await getDefaultScheduleSettings(supabase, session.session_date);
    const described = describeSessionDeletion({ session, events: events || [], checksCount: checks.length, studyWindows: defaultSchedule.studyWindows });
    const studentName = session.students?.name || '학생';

    if (!confirmed) {
      return Response.json({ ok: false, needsConfirm: true, studentName, sessionDate: session.session_date, ...described });
    }

    await supabase.from('attendance_events').delete().eq('session_id', sessionId);
    try { await supabase.from('study_checks').delete().eq('session_id', sessionId); } catch { /* 순찰 표가 없는 환경 */ }
    const { error: deleteError } = await supabase.from('daily_sessions').delete().eq('id', sessionId);
    if (deleteError) throw deleteError;

    await writeUserActionLog(supabase, request, {
      actionType: 'attendance.session.delete',
      targetType: 'daily_session',
      targetId: sessionId,
      targetName: `${studentName} ${session.session_date} 출결 기록 전체 삭제`,
      payload: {
        studentId: session.student_id,
        studentName,
        sessionDate: session.session_date,
        summary: described.summary,
        // 복구가 필요할 때를 위해 지운 내용을 그대로 남깁니다.
        deletedSession: { ...session, students: undefined },
        deletedEvents: events || [],
        deletedChecks: checks,
        deletedBy: actorName,
      },
    });

    return Response.json({ ok: true, message: `${studentName} 학생의 ${session.session_date} 출결 기록 ${(events || []).length}건을 모두 삭제했습니다. 이 날은 미입실로 돌아갔습니다.` });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
