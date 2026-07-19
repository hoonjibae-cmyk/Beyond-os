import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, getAuthorizedUser, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

// 학생 기본정보 탭 — 관리자 특이사항(자유 서술) 저장 전용 경량 엔드포인트.
// 학생 전체 폼(설정 > 학생 관리)을 거치지 않고 특이사항만 단독으로 갱신합니다.
export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const studentId = body.studentId || body.id;
    if (!studentId) {
      return Response.json({ error: 'studentId가 필요합니다.' }, { status: 400 });
    }

    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || actor?.username || '관리자';
    const nowIso = new Date().toISOString();

    const payload = {
      admin_note: note || null,
      admin_note_updated_at: note ? nowIso : null,
      admin_note_updated_by: note ? actorName : null,
    };

    const { data, error } = await supabase
      .from('students')
      .update(payload)
      .eq('id', studentId)
      .select('id, name, admin_note, admin_note_updated_at, admin_note_updated_by')
      .single();

    if (error) throw error;

    await writeUserActionLog(supabase, request, {
      actionType: 'student.note.update',
      targetType: 'student',
      targetId: studentId,
      targetName: data?.name,
      payload: { length: note.length },
    }).catch(() => null);

    return Response.json({ student: data });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
