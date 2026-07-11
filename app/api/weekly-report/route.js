import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function attachStudentSnapshots(supabase, reports = []) {
  const ids = [...new Set((reports || []).map((row) => row.student_id).filter(Boolean))];
  if (!ids.length) return reports || [];

  const { data: students } = await supabase
    .from('students')
    .select('id,name,school,grade,status,parent_phone')
    .in('id', ids);

  const studentMap = {};
  for (const student of students || []) studentMap[student.id] = student;

  return (reports || []).map((report) => ({
    ...report,
    student: studentMap[report.student_id] || null,
  }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const startDate = toDate(searchParams.get('start'));
    const endDate = toDate(searchParams.get('end'));
    const mode = searchParams.get('mode');

    if (!startDate || !endDate) {
      return Response.json({ error: 'start, end are required' }, { status: 400 });
    }

    if (!studentId) {
      let query = supabase
        .from('weekly_reports')
        .select('*');

      if (mode === 'history') {
        query = query
          .lte('start_date', endDate)
          .gte('end_date', startDate)
          .order('start_date', { ascending: false })
          .order('updated_at', { ascending: false });
      } else {
        query = query
          .eq('start_date', startDate)
          .eq('end_date', endDate)
          .order('updated_at', { ascending: false });
      }

      const { data, error } = await query;

      if (error) {
        return Response.json({
          reports: [],
          warning: 'weekly_reports 테이블이 아직 없거나 조회할 수 없습니다. v40-10 SQL을 실행하세요.',
        });
      }

      const reports = mode === 'history' ? await attachStudentSnapshots(supabase, data || []) : (data || []);

      return Response.json({
        reports,
        mode: mode === 'history' ? 'history' : 'exact',
        range: { start: startDate, end: endDate },
      });
    }

    const { data, error } = await supabase
      .from('weekly_reports')
      .select('*')
      .eq('student_id', studentId)
      .eq('start_date', startDate)
      .eq('end_date', endDate)
      .maybeSingle();

    if (error) {
      return Response.json({
        report: null,
        warning: 'weekly_reports 테이블이 아직 없거나 조회할 수 없습니다. v40-10 SQL을 실행하세요.',
      });
    }

    return Response.json({ report: data || null });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';

    const studentId = body.studentId;
    const startDate = toDate(body.startDate);
    const endDate = toDate(body.endDate);

    if (!studentId || !startDate || !endDate) {
      return Response.json({ error: 'studentId, startDate, endDate are required' }, { status: 400 });
    }

    const payload = {
      student_id: studentId,
      start_date: startDate,
      end_date: endDate,
      summary_payload: body.summaryPayload || {},
      director_interview: String(body.directorInterview || '').trim() || null,
      ai_weekly_comment: String(body.aiWeeklyComment || '').trim() || null,
      final_weekly_comment: String(body.finalWeeklyComment || '').trim() || null,
      report_text: String(body.reportText || '').trim() || null,
      created_by: actorName,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('weekly_reports')
      .upsert(payload, { onConflict: 'student_id,start_date,end_date' })
      .select()
      .single();

    if (error) {
      return Response.json({
        error: `${error.message} / Supabase에서 beyond-os-supabase-weekly-reports-v40-10.sql을 먼저 실행하세요.`,
      }, { status: 500 });
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'weekly_report.save',
      targetType: 'weekly_report',
      targetId: data.id,
      targetName: data.student_id,
      payload: {
        studentId,
        startDate,
        endDate,
      },
    });

    return Response.json({ ok: true, report: data });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
