// Beyond OS v41-266 — 다음 기수 등록불가 표시/해제
// 로그인한 사용자 누구나 할 수 있습니다. (isAuthorized = 개인 계정 또는 관리자 비밀번호)
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { buildEnrollmentBlockPayload, ENROLLMENT_BLOCK_SQL_HINT } from '../../../lib/enrollmentBlock';

export const dynamic = 'force-dynamic';

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes('enrollment_block') || message.includes('schema cache');
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const studentId = String(body.studentId || '').trim();
    const blocked = body.blocked === true;
    const reason = String(body.reason || '').trim();
    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });
    if (blocked && !reason) return Response.json({ error: '등록불가 사유를 입력하세요.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const { data: existing, error: existingError } = await supabase
      .from('students').select('id, name, enrollment_blocked, enrollment_block_reason').eq('id', studentId).single();
    if (existingError) {
      if (isMissingColumnError(existingError)) return Response.json({ error: `등록불가 표시 칸이 아직 없습니다. ${ENROLLMENT_BLOCK_SQL_HINT}` }, { status: 400 });
      throw existingError;
    }

    const payload = buildEnrollmentBlockPayload({ blocked, reason, actorName });
    const { data: student, error } = await supabase
      .from('students').update(payload).eq('id', studentId).select('*').single();
    if (error) {
      if (isMissingColumnError(error)) return Response.json({ error: `등록불가 표시 칸이 아직 없습니다. ${ENROLLMENT_BLOCK_SQL_HINT}` }, { status: 400 });
      throw error;
    }

    await writeUserActionLog(supabase, request, {
      actionType: blocked ? 'student.enrollment_block.set' : 'student.enrollment_block.clear',
      targetType: 'student',
      targetId: studentId,
      targetName: existing?.name || studentId,
      payload: {
        previousBlocked: Boolean(existing?.enrollment_blocked),
        previousReason: existing?.enrollment_block_reason || null,
        blocked,
        reason: payload.enrollment_block_reason,
        updatedBy: actorName,
      },
    }).catch(() => {});

    return Response.json({
      ok: true,
      student,
      message: blocked
        ? `${existing?.name || '학생'} — 다음기수 등록불가로 표시했습니다.`
        : `${existing?.name || '학생'} — 등록불가 표시를 해제했습니다.`,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
