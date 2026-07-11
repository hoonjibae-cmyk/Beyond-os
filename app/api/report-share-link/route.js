import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, getAuthorizedUser } from '../../../lib/auth';
import { ensureReportShareLink, getPublicReportUrl } from '../../../lib/reportShare';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function isExpired(link) {
  return link?.expires_at && new Date(link.expires_at).getTime() < Date.now();
}

function makeTargetLabel(link, dailyMap = {}, weeklyMap = {}, studentMap = {}) {
  if (link.report_type === 'daily') {
    const report = dailyMap[String(link.report_id)] || {};
    const session = report.session || {};
    const student = studentMap[String(session.student_id)] || session.students || {};
    return [student.name, session.session_date].filter(Boolean).join(' · ') || link.report_id;
  }

  const report = weeklyMap[String(link.report_id)] || {};
  const student = studentMap[String(report.student_id)] || {};
  return [student.name, [report.start_date, report.end_date].filter(Boolean).join(' ~ ')].filter(Boolean).join(' · ') || link.report_id;
}

async function enrichLinks(supabase, request, links = []) {
  const dailyIds = links.filter((item) => item.report_type === 'daily').map((item) => item.report_id);
  const weeklyIds = links.filter((item) => item.report_type === 'weekly').map((item) => item.report_id);

  const dailyMap = {};
  const weeklyMap = {};
  const studentMap = {};

  try {
    if (dailyIds.length) {
      const { data: dailyReports } = await supabase
        .from('daily_reports')
        .select('id, session_id')
        .in('id', dailyIds);
      for (const report of dailyReports || []) dailyMap[String(report.id)] = report;

      const sessionIds = (dailyReports || []).map((item) => item.session_id).filter(Boolean);
      if (sessionIds.length) {
        const { data: sessions } = await supabase
          .from('daily_sessions')
          .select('id, session_date, student_id, students(name, school, grade)')
          .in('id', sessionIds);
        for (const session of sessions || []) {
          for (const report of Object.values(dailyMap)) {
            if (String(report.session_id) === String(session.id)) report.session = session;
          }
          if (session.student_id && session.students) studentMap[String(session.student_id)] = session.students;
        }
      }
    }

    if (weeklyIds.length) {
      const { data: weeklyReports } = await supabase
        .from('weekly_reports')
        .select('id, student_id, start_date, end_date')
        .in('id', weeklyIds);
      for (const report of weeklyReports || []) weeklyMap[String(report.id)] = report;

      const studentIds = (weeklyReports || []).map((item) => item.student_id).filter(Boolean);
      if (studentIds.length) {
        const { data: students } = await supabase
          .from('students')
          .select('id, name, school, grade')
          .in('id', studentIds);
        for (const student of students || []) studentMap[String(student.id)] = student;
      }
    }
  } catch {
    // 링크 목록 자체는 표시합니다.
  }

  return links.map((link) => ({
    ...link,
    url: getPublicReportUrl(request, link.token),
    expired: isExpired(link),
    target_label: makeTargetLabel(link, dailyMap, weeklyMap, studentMap),
  }));
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'active';
    const reportType = searchParams.get('reportType');
    const reportIds = String(searchParams.get('reportIds') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const limit = reportIds.length ? Math.min(500, Math.max(1, reportIds.length * 2)) : Math.min(300, Math.max(1, Number(searchParams.get('limit') || 120)));

    let query = supabase
      .from('report_share_links')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (reportType === 'daily' || reportType === 'weekly') {
      query = query.eq('report_type', reportType);
    }
    if (reportIds.length) {
      query = query.in('report_id', reportIds);
    }

    if (status === 'active') {
      query = query.eq('is_active', true).gt('expires_at', new Date().toISOString());
    } else if (status === 'revoked') {
      query = query.eq('is_active', false);
    } else if (status === 'expired') {
      query = query.lt('expires_at', new Date().toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    const links = await enrichLinks(supabase, request, data || []);
    const linksByReportId = {};
    for (const link of links) {
      const key = String(link.report_id || '');
      if (key && !linksByReportId[key]) linksByReportId[key] = link;
    }
    return Response.json({ links, linksByReportId, status, reportType: reportType || null, reportIds, limit });
  } catch (error) {
    return Response.json({
      error: `${error.message || '공개 리포트 링크 조회 중 오류가 발생했습니다.'} / v40-83 SQL 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = body.action || 'create';
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';
    const supabase = getSupabaseAdmin();

    if (action === 'create') {
      const reportType = body.reportType === 'weekly' ? 'weekly' : 'daily';
      const reportId = body.reportId;

      if (!reportId) {
        return Response.json({ error: 'reportId is required' }, { status: 400 });
      }

      const link = await ensureReportShareLink(supabase, request, {
        reportType,
        reportId,
        createdBy: actorName,
        expiresDays: Number(body.expiresDays || 30),
      });

      await writeUserActionLog(supabase, request, {
        actionType: `${reportType}_report.share_link`,
        targetType: `${reportType}_report`,
        targetId: reportId,
        targetName: `${reportType} 공개 리포트 링크`,
        payload: {
          reportType,
          reportId,
          url: link.url,
          token: link.token,
          error: link.error || null,
        },
      });

      return Response.json({
        ok: Boolean(link.url),
        reportType,
        reportId,
        url: link.url,
        token: link.token,
        error: link.error || null,
      });
    }

    if (action === 'revoke') {
      const id = body.id;
      const token = body.token;

      if (!id && !token) {
        return Response.json({ error: 'id or token is required' }, { status: 400 });
      }

      let query = supabase.from('report_share_links').update({ is_active: false });
      query = id ? query.eq('id', id) : query.eq('token', token);
      const { data, error } = await query.select().single();

      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'report_share_link.revoke',
        targetType: 'report_share_link',
        targetId: data.id,
        targetName: data.token,
        payload: {
          reportType: data.report_type,
          reportId: data.report_id,
          token: data.token,
        },
      });

      return Response.json({ ok: true, link: data, message: '공개 리포트 링크를 비활성화했습니다.' });
    }

    if (action === 'extend') {
      const id = body.id;
      const token = body.token;
      const days = Math.max(1, Number(body.expiresDays || 30));
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      if (!id && !token) {
        return Response.json({ error: 'id or token is required' }, { status: 400 });
      }

      let query = supabase.from('report_share_links').update({ is_active: true, expires_at: expiresAt });
      query = id ? query.eq('id', id) : query.eq('token', token);
      const { data, error } = await query.select().single();

      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'report_share_link.extend',
        targetType: 'report_share_link',
        targetId: data.id,
        targetName: data.token,
        payload: {
          reportType: data.report_type,
          reportId: data.report_id,
          token: data.token,
          expiresAt,
        },
      });

      return Response.json({ ok: true, link: data, message: '공개 리포트 링크 만료일을 연장했습니다.' });
    }

    return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: `${error.message || '공개 리포트 링크 처리 중 오류가 발생했습니다.'} / v40-83 SQL 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}
