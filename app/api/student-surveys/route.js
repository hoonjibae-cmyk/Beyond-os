import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

// 설문의 학생 이름(+학교/학년)으로 기존 학생을 찾습니다.
function matchStudent(students, name, schoolGrade) {
  const target = normalizeName(name);
  if (!target) return null;
  const candidates = (students || []).filter((s) => normalizeName(s.name) === target);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && schoolGrade) {
    const sg = normalizeName(schoolGrade);
    const bySchool = candidates.find((s) => s.school && sg.includes(normalizeName(s.school)));
    if (bySchool) return bySchool;
  }
  return candidates[0] || null;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');

    let query = supabase
      .from('student_surveys')
      .select('*')
      .order('survey_type', { ascending: true })
      .order('updated_at', { ascending: false });
    if (studentId && studentId !== 'all') query = query.eq('student_id', studentId);

    const { data, error } = await query;
    if (error) {
      return Response.json({ surveys: [], warning: `${error.message} / student_surveys 테이블이 없으면 beyond-os-supabase-student-surveys-v41-57.sql을 먼저 실행하세요.` });
    }
    return Response.json({ surveys: data || [] });
  } catch (error) {
    return Response.json({ surveys: [], warning: error.message || 'Unknown error' });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const surveyType = body.surveyType === 'parent' ? 'parent' : 'student';
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return Response.json({ error: '업로드할 설문 응답이 없습니다.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: students, error: studentsError } = await supabase.from('students').select('id,name,school,grade');
    if (studentsError) throw studentsError;

    let matchedCount = 0;
    const unmatchedNames = [];
    const payload = rows
      .map((row) => {
        const studentName = String(row.studentName || '').trim();
        if (!studentName) return null;
        const schoolGrade = String(row.schoolGrade || '').trim() || null;
        const matched = matchStudent(students || [], studentName, schoolGrade);
        if (matched) matchedCount += 1;
        else unmatchedNames.push(studentName);
        return {
          student_id: matched?.id || null,
          survey_type: surveyType,
          student_name: studentName,
          school_grade: schoolGrade,
          respondent_name: String(row.respondentName || '').trim() || null,
          submitted_at: row.submittedAt || null,
          answers: Array.isArray(row.answers) ? row.answers : [],
          matched: Boolean(matched),
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);

    const { data: saved, error: upsertError } = await supabase
      .from('student_surveys')
      .upsert(payload, { onConflict: 'survey_type,student_name,school_grade' })
      .select();
    if (upsertError) {
      return Response.json({ error: `${upsertError.message} / student_surveys 테이블이 없으면 beyond-os-supabase-student-surveys-v41-57.sql을 먼저 실행하세요.` }, { status: 500 });
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'survey.bulk_upload',
      targetType: 'student_survey',
      targetName: `${surveyType === 'parent' ? '학부모' : '학생'} 설문 ${payload.length}건`,
      payload: { surveyType, total: payload.length, matched: matchedCount, unmatched: unmatchedNames.length },
    });

    return Response.json({
      saved: saved?.length || payload.length,
      total: payload.length,
      matched: matchedCount,
      unmatched: unmatchedNames.length,
      unmatchedNames: [...new Set(unmatchedNames)],
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
