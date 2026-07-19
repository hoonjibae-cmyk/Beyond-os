import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

function normalizeSeatNo(value) {
  if (value === null || value === undefined || value === '' || value === 'unassigned') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 26) return null;
  return n;
}

function normalizeGuardians(body = {}) {
  const rows = Array.isArray(body.guardians) ? body.guardians : [];
  const normalized = rows
    .map((item, index) => ({
      id: item.id && !String(item.id).startsWith('new-') && !String(item.id).startsWith('local-') && item.id !== 'legacy-parent-phone' ? item.id : null,
      guardian_name: String(item.guardianName || item.guardian_name || '').trim() || null,
      relationship: (() => {
        const raw = String(item.relationship || '모').trim();
        if (['모', '어머니', '엄마', '대표 보호자', '대표보호자', '보호자'].includes(raw)) return '모';
        if (['부', '아버지', '아빠'].includes(raw)) return '부';
        if (['조부모', '조부', '조모', '할아버지', '할머니'].includes(raw)) return '조부모';
        if (raw === '기타') return '기타';
        return '모';
      })(),
      phone: String(item.phone || '').trim(),
      is_primary: Boolean(item.isPrimary ?? item.is_primary ?? index === 0),
      receive_daily_report: Boolean(item.receiveDailyReport ?? item.receive_daily_report ?? true),
      receive_weekly_report: Boolean(item.receiveWeeklyReport ?? item.receive_weekly_report ?? true),
      is_active: Boolean(item.isActive ?? item.is_active ?? true),
      memo: String(item.memo || '').trim() || null,
    }))
    .filter((item) => item.phone || item.guardian_name || item.relationship);

  if (!normalized.length && body.parentPhone) {
    normalized.push({
      id: null,
      guardian_name: null,
      relationship: '모',
      phone: String(body.parentPhone || '').trim(),
      is_primary: true,
      receive_daily_report: true,
      receive_weekly_report: true,
      is_active: true,
      memo: '기존 학부모 연락처에서 저장',
    });
  }

  const primaryIndex = normalized.findIndex((item) => item.is_primary);
  if (normalized.length && primaryIndex < 0) normalized[0].is_primary = true;
  return normalized.map((item, index) => ({ ...item, is_primary: index === normalized.findIndex((row) => row.is_primary) }));
}

async function saveGuardians(supabase, studentId, guardians) {
  const normalized = normalizeGuardians({ guardians });
  const keepIds = normalized.map((item) => item.id).filter(Boolean);

  if (keepIds.length) {
    const { error } = await supabase
      .from('student_guardians')
      .delete()
      .eq('student_id', studentId)
      .not('id', 'in', `(${keepIds.join(',')})`);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('student_guardians').delete().eq('student_id', studentId);
    if (error) throw error;
  }

  for (const guardian of normalized) {
    const payload = {
      student_id: studentId,
      guardian_name: guardian.guardian_name,
      relationship: guardian.relationship,
      phone: guardian.phone || null,
      is_primary: guardian.is_primary,
      receive_daily_report: guardian.receive_daily_report,
      receive_weekly_report: guardian.receive_weekly_report,
      is_active: guardian.is_active,
      memo: guardian.memo,
    };

    if (guardian.id) {
      const { error } = await supabase.from('student_guardians').update(payload).eq('id', guardian.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('student_guardians').insert(payload);
      if (error) throw error;
    }
  }

  return normalized;
}

function getPrimaryPhone(body = {}) {
  const guardians = normalizeGuardians(body);
  const primary = guardians.find((item) => item.is_primary && item.phone) || guardians.find((item) => item.phone);
  return primary?.phone || body.parentPhone || null;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .order('status', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;

    return Response.json({ students: data || [] });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const name = String(body.name || '').trim();
    if (!name) {
      return Response.json({ error: '학생명을 입력하세요.' }, { status: 400 });
    }

    const requestedStatus = body.status || 'active';
    const seatNo = requestedStatus === 'inactive' ? null : normalizeSeatNo(body.seatNo);
    const studentId = body.id || null;
    const today = getKstDateString();

    const { data: duplicateNameStudents, error: duplicateNameError } = await supabase
      .from('students')
      .select('id,name,status,school,grade')
      .eq('name', name)
      .neq('id', studentId || '00000000-0000-0000-0000-000000000000')
      .neq('status', 'inactive');

    if (duplicateNameError) throw duplicateNameError;

    if ((duplicateNameStudents || []).length) {
      return Response.json({
        error: `이미 같은 이름의 활성 학생이 있습니다: ${name}. 동명이인 학생은 키오스크 자동 출결 매칭을 위해 이름 뒤에 구분표시를 붙여 저장하세요. 예: ${name}A, ${name}①, ${name}(중1)`
      }, { status: 409 });
    }

    if (seatNo) {
      const { data: duplicateDefaultStudents, error: duplicateDefaultError } = await supabase
        .from('students')
        .select('id,name,status,default_seat_no')
        .eq('default_seat_no', seatNo)
        .neq('id', studentId || '00000000-0000-0000-0000-000000000000')
        .neq('status', 'inactive');

      if (duplicateDefaultError) throw duplicateDefaultError;

      if ((duplicateDefaultStudents || []).length) {
        return Response.json({
          error: `${seatNo}번 좌석은 이미 ${duplicateDefaultStudents.map((student) => student.name).join(', ')} 학생의 기본 좌석입니다. 먼저 해당 학생의 좌석을 변경하거나 미배정으로 바꿔주세요.`,
        }, { status: 409 });
      }
    }

    const studentPayload = {
      name,
      school: body.school || null,
      grade: body.grade || null,
      parent_phone: getPrimaryPhone(body),
      student_phone: body.studentPhone || null,
      default_seat_no: seatNo,
      status: requestedStatus,
      nickname: String(body.nickname || '').trim() || null,
      ranking_opt_in: Boolean(body.rankingOptIn),
    };

    let savedStudent;

    if (studentId) {
      const { data, error } = await supabase
        .from('students')
        .update(studentPayload)
        .eq('id', studentId)
        .select()
        .single();

      if (error) throw error;
      savedStudent = data;
    } else {
      const { data, error } = await supabase
        .from('students')
        .insert(studentPayload)
        .select()
        .single();

      if (error) throw error;
      savedStudent = data;
    }

    await saveGuardians(supabase, savedStudent.id, normalizeGuardians(body));

    // 이 학생이 이전 좌석에 남아 있는 값을 모두 제거합니다.
    const { error: clearStudentSeatsError } = await supabase
      .from('seats')
      .update({ current_student_id: null })
      .eq('current_student_id', savedStudent.id);
    if (clearStudentSeatsError) throw clearStudentSeatsError;

    // 선택 좌석에 남아 있는 오래된 연결값은 학생 기본 좌석 기준으로 정리합니다.
    if (seatNo) {
      const { error: clearTargetSeatError } = await supabase
        .from('seats')
        .update({ current_student_id: null })
        .eq('seat_no', seatNo);
      if (clearTargetSeatError) throw clearTargetSeatError;

      const { error: seatUpdateError } = await supabase
        .from('seats')
        .update({ current_student_id: savedStudent.id })
        .eq('seat_no', seatNo);

      if (seatUpdateError) throw seatUpdateError;
    }

    // 오늘 세션이 있으면 학생 기본 좌석 변경을 오늘 운영 데이터에도 반영합니다.
    // 과거 세션은 출결 기록 보존을 위해 건드리지 않습니다.
    if (seatNo) {
      await supabase
        .from('daily_sessions')
        .update({ seat_no: seatNo })
        .eq('student_id', savedStudent.id)
        .eq('session_date', today);
    }

    await writeUserActionLog(supabase, request, {
      actionType: studentId ? 'student.update' : 'student.create',
      targetType: 'student',
      targetId: savedStudent.id,
      targetName: savedStudent.name,
      payload: {
        seatNo,
        status: requestedStatus,
        guardianCount: normalizeGuardians(body).length,
      },
    });

    const { data: savedWithGuardians } = await supabase
      .from('students')
      .select('*, student_guardians(*)')
      .eq('id', savedStudent.id)
      .single();

    return Response.json({ student: savedWithGuardians || savedStudent, seatNo });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}


export async function DELETE(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const studentId = body.id || body.studentId;
    const mode = body.mode === 'delete' ? 'delete' : 'deactivate';

    if (!studentId) {
      return Response.json({ error: 'student id is required' }, { status: 400 });
    }

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student) return Response.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

    await supabase
      .from('seats')
      .update({ current_student_id: null })
      .eq('current_student_id', studentId);

    if (mode === 'deactivate') {
      const { data, error } = await supabase
        .from('students')
        .update({
          status: 'inactive',
          default_seat_no: null,
        })
        .eq('id', studentId)
        .select()
        .single();

      if (error) throw error;

      // 비활성화 시 멘토링 연결(멘토별 담당학생 + 차시 템플릿 배정 + 오늘 이후 날짜별 배정)을 즉시 해제합니다.
      // 앱의 다른 해제 로직과 동일하게 소프트 삭제(is_active=false)로 처리하며,
      // 테이블이 아직 없거나 오류가 나도 비활성화 자체는 실패하지 않도록 무시합니다.
      const detachToday = getKstDateString();
      await Promise.allSettled([
        supabase.from('mentoring_mentor_students').update({ is_active: false }).eq('student_id', studentId).eq('is_active', true),
        supabase.from('mentoring_assignments').update({ is_active: false }).eq('student_id', studentId).eq('is_active', true),
        supabase.from('mentoring_date_assignments').update({ is_active: false }).eq('student_id', studentId).eq('is_active', true).gte('schedule_date', detachToday),
      ]);

      await writeUserActionLog(supabase, request, {
        actionType: 'student.deactivate',
        targetType: 'student',
        targetId: studentId,
        targetName: student.name,
        payload: { mode },
      });

      return Response.json({
        ok: true,
        mode,
        student: data,
        message: '학생을 비활성화했습니다. DB와 과거 기록은 보존됩니다.',
      });
    }

    if (student.status !== 'inactive') {
      return Response.json({
        error: '완전 삭제는 비활성 학생에게만 사용할 수 있습니다. 먼저 비활성화한 뒤 다시 시도하세요.',
      }, { status: 409 });
    }

    const { error: deleteError } = await supabase
      .from('students')
      .delete()
      .eq('id', studentId);

    if (deleteError) {
      return Response.json({
        error: `학생 DB 완전 삭제에 실패했습니다. 출결/리포트/시간표 기록이 연결된 학생은 비활성화를 권장합니다. (${deleteError.message})`,
      }, { status: 409 });
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'student.delete',
      targetType: 'student',
      targetId: studentId,
      targetName: student.name,
      payload: { mode },
    });

    return Response.json({
      ok: true,
      mode,
      studentId,
      message: '학생 DB를 완전히 삭제했습니다.',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
