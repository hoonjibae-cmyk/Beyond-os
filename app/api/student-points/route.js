import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizePointType(value) {
  return value === 'penalty' ? 'penalty' : 'reward';
}

function summarize(rows = []) {
  const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
  const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
  return {
    reward,
    penalty,
    net: reward - penalty,
    count: rows.length,
  };
}

async function attachStudents(supabase, rows = []) {
  const ids = [...new Set(rows.map((row) => String(row.student_id || '')).filter(Boolean))];
  const studentMap = {};
  if (ids.length) {
    try {
      const { data } = await supabase
        .from('students')
        .select('id, name, school, grade')
        .in('id', ids);
      for (const student of data || []) studentMap[String(student.id)] = student;
    } catch {
      // 학생 표시 정보 없이도 상벌점 기록은 반환합니다.
    }
  }
  return rows.map((row) => ({ ...row, student: studentMap[String(row.student_id)] || null }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const start = toDate(searchParams.get('start'));
    const end = toDate(searchParams.get('end'));
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200)));

    let query = supabase
      .from('student_points')
      .select('*')
      .eq('is_deleted', false)
      .order('point_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (studentId) query = query.eq('student_id', String(studentId));
    if (start) query = query.gte('point_date', start);
    if (end) query = query.lte('point_date', end);

    const { data, error } = await query;
    if (error) throw error;

    const rows = await attachStudents(supabase, data || []);
    return Response.json({ rows, summary: summarize(rows) });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 조회 중 오류가 발생했습니다.'} / beyond-os-supabase-student-points-v40-90.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = body.action || 'create';
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';

    if (action === 'create') {
      const studentId = String(body.studentId || '').trim();
      const pointDate = toDate(body.pointDate) || new Date().toISOString().slice(0, 10);
      const pointType = normalizePointType(body.pointType);
      const points = Math.max(1, Math.round(Number(body.points || 1)));
      const reason = String(body.reason || '').trim();
      const memo = String(body.memo || '').trim();

      if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });
      if (!reason) return Response.json({ error: '상벌점 사유를 입력하세요.' }, { status: 400 });

      const { data, error } = await supabase
        .from('student_points')
        .insert({
          student_id: studentId,
          point_date: pointDate,
          point_type: pointType,
          points,
          reason,
          memo: memo || null,
          created_by: actorName,
          is_deleted: false,
        })
        .select()
        .single();

      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'student_points.create',
        targetType: 'student_points',
        targetId: data.id,
        targetName: studentId,
        payload: { studentId, pointDate, pointType, points, reason, memo },
      });

      return Response.json({ ok: true, row: data, message: `${pointType === 'reward' ? '상점' : '벌점'} ${points}점 기록 완료` });
    }

    if (action === 'delete') {
      const id = body.id;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data, error } = await supabase
        .from('student_points')
        .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: actorName })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'student_points.delete',
        targetType: 'student_points',
        targetId: data.id,
        targetName: data.student_id,
        payload: { id, studentId: data.student_id, pointType: data.point_type, points: data.points, reason: data.reason },
      });

      return Response.json({ ok: true, row: data, message: '상벌점 기록을 삭제했습니다.' });
    }

    return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: `${error.message || '상벌점 처리 중 오류가 발생했습니다.'} / beyond-os-supabase-student-points-v40-90.sql 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}
