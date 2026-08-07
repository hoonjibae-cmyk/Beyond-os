import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function makeKstIso(dateString, timeValue) {
  const date = String(dateString || '').slice(0, 10);
  const time = String(timeValue || '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function syncSessionCurrentStudy(supabase, sessionId) {
  if (!sessionId) return null;
  const { data: latest, error: latestError } = await supabase
    .from('study_checks')
    .select('id, subject, study_status, checked_at')
    .eq('session_id', sessionId)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;

  const { error: sessionError } = await supabase
    .from('daily_sessions')
    .update({
      current_study_status: latest?.study_status || null,
      current_subject: latest?.subject || null,
    })
    .eq('id', sessionId);

  if (sessionError) throw sessionError;
  return latest || null;
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    if (!body.sessionId || !body.studentId || !body.seatNo) {
      return Response.json({ error: 'sessionId, studentId, seatNo are required' }, { status: 400 });
    }

    const payload = {
      session_id: body.sessionId,
      student_id: body.studentId,
      seat_no: Number(body.seatNo),
      study_status: body.studyStatus,
      subject: body.subject,
      study_content: body.studyContent || null,
      mentor_memo: null,
      checked_by: actorName,
    };

    const { data, error } = await supabase
      .from('study_checks')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    await syncSessionCurrentStudy(supabase, body.sessionId);

    await writeUserActionLog(supabase, request, {
      actionType: 'study_check.create',
      targetType: 'study_check',
      targetId: data.id,
      targetName: `${body.seatNo}번 좌석`,
      payload: {
        sessionId: body.sessionId,
        studentId: body.studentId,
        seatNo: Number(body.seatNo),
        studyStatus: body.studyStatus,
        subject: body.subject,
      },
    });

    return Response.json({ check: data });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}


export async function PUT(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const checkId = body.checkId || body.id;
    if (!checkId) {
      return Response.json({ error: 'checkId is required' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from('study_checks')
      .select('*')
      .eq('id', checkId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) return Response.json({ error: '수정할 순찰 기록을 찾지 못했습니다.' }, { status: 404 });

    const payload = {
      study_status: body.studyStatus || null,
      subject: body.subject || null,
      study_content: String(body.studyContent || '').trim() || null,
      checked_by: actorName,
    };

    const checkedAt = body.checkedAt || makeKstIso(body.checkedDate, body.checkedTime);
    if (checkedAt) payload.checked_at = checkedAt;

    const { data, error } = await supabase
      .from('study_checks')
      .update(payload)
      .eq('id', checkId)
      .select()
      .single();

    if (error) throw error;

    const latestStudy = await syncSessionCurrentStudy(supabase, data.session_id || existing.session_id);

    await writeUserActionLog(supabase, request, {
      actionType: 'study_check.update',
      targetType: 'study_check',
      targetId: data.id,
      targetName: `${data.seat_no || existing.seat_no || '-'}번 좌석`,
      payload: {
        sessionId: data.session_id || existing.session_id,
        studentId: data.student_id || existing.student_id,
        seatNo: Number(data.seat_no || existing.seat_no || 0) || null,
        studyStatus: data.study_status,
        subject: data.subject,
        checkedAt: data.checked_at,
      },
    });

    return Response.json({ check: data, latestStudy });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

// v41-144: 잘못 입력된 순찰 기록을 한 건씩 삭제합니다.
// 삭제 후에는 좌석 카드에 표시되는 '현재 학습 상태/과목'을 남은 기록 기준으로 다시 맞춥니다.
export async function DELETE(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    const checkId = body.checkId || body.id || searchParams.get('checkId') || '';
    if (!checkId) {
      return Response.json({ error: 'checkId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from('study_checks')
      .select('*')
      .eq('id', checkId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) return Response.json({ error: '삭제할 순찰 기록을 찾지 못했습니다. 이미 삭제되었을 수 있습니다.' }, { status: 404 });

    const { error: deleteError } = await supabase
      .from('study_checks')
      .delete()
      .eq('id', checkId);

    if (deleteError) throw deleteError;

    const latestStudy = await syncSessionCurrentStudy(supabase, existing.session_id);

    await writeUserActionLog(supabase, request, {
      actionType: 'study_check.delete',
      targetType: 'study_check',
      targetId: checkId,
      targetName: `${existing.seat_no || '-'}번 좌석`,
      payload: {
        sessionId: existing.session_id,
        studentId: existing.student_id,
        seatNo: Number(existing.seat_no || 0) || null,
        checkedAt: existing.checked_at,
        subject: existing.subject,
        studyStatus: existing.study_status,
        studyContent: existing.study_content,
      },
    });

    return Response.json({
      ok: true,
      deletedId: checkId,
      latestStudy,
      message: '순찰 기록을 삭제했습니다.',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
