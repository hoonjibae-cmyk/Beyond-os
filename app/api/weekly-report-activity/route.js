// Beyond OS v41-288
// 그 주에 개인 시간표도 없고 등원 기록도 없는 학생 목록. 위클리 전체 발송 창이 제외 대상을 보여 줄 때 씁니다.
//   GET ?start=YYYY-MM-DD&end=YYYY-MM-DD[&studentIds=a,b,c]   (studentIds 없으면 활성 학생 전원)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireTabPermission } from '../../../lib/auth';
import { selectInChunksSafe } from '../../../lib/supabaseChunk';
import { findWeeklyInactiveStudentIds, WEEKLY_NO_ACTIVITY_MESSAGE } from '../../../lib/weeklyActivity';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const denied = requireTabPermission(request, 'weeklyReports');
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const start = String(searchParams.get('start') || '').slice(0, 10);
    const end = String(searchParams.get('end') || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return Response.json({ error: 'start, end are required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    let studentIds = String(searchParams.get('studentIds') || '').split(',').map((v) => v.trim()).filter(Boolean);
    let nameById = {};
    if (!studentIds.length) {
      const { data } = await supabase.from('students').select('id,name,status').neq('status', 'inactive');
      studentIds = (data || []).map((row) => String(row.id));
      for (const row of data || []) nameById[String(row.id)] = row.name;
    } else {
      const found = await selectInChunksSafe(studentIds, (part) => supabase.from('students').select('id,name').in('id', part));
      for (const row of found.rows || []) nameById[String(row.id)] = row.name;
    }
    const found = await findWeeklyInactiveStudentIds(supabase, studentIds, { start, end });
    const inactive = [...found.inactiveIds].map((id) => ({ studentId: id, name: nameById[id] || '학생' }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    return Response.json({ ok: true, start, end, inactive, inactiveStudentIds: inactive.map((row) => row.studentId), reason: WEEKLY_NO_ACTIVITY_MESSAGE, warning: found.warning });
  } catch (error) {
    return Response.json({ error: error.message || '시간표·등원 기록 확인 실패' }, { status: 500 });
  }
}
