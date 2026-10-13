// Beyond OS v41-268 — 등록불가 학생 메뉴
// enrollment_blocked = true 인 학생을 전부(퇴원 학생 포함) 읽어 기수별로 묶어 돌려줍니다.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { normalizeCohort, resolveCohortForDate, sortCohorts } from '../../../lib/cohorts';
import { groupBlockedStudentsByCohort, ENROLLMENT_BLOCK_SQL_HINT } from '../../../lib/enrollmentBlock';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    let cohorts = [];
    try {
      const { data } = await supabase.from('cohorts').select('*');
      cohorts = sortCohorts((data || []).map(normalizeCohort));
    } catch {
      cohorts = [];
    }

    const { data: students, error } = await supabase
      .from('students')
      .select('id, name, school, grade, student_phone, status, enrollment_blocked, enrollment_block_reason, enrollment_block_updated_at, enrollment_block_updated_by, enrollment_block_cohort_id, enrollment_block_cohort_name')
      .eq('enrollment_blocked', true);
    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (error.code === '42703' || message.includes('enrollment_block') || message.includes('schema cache')) {
        // v41-266 칸은 있는데 v41-268 기수 칸만 없는 경우를 한 번 더 시도합니다.
        const retry = await supabase
          .from('students')
          .select('id, name, school, grade, student_phone, status, enrollment_blocked, enrollment_block_reason, enrollment_block_updated_at, enrollment_block_updated_by')
          .eq('enrollment_blocked', true);
        if (retry.error) {
          return Response.json({ ok: true, groups: [], total: 0, warning: `등록불가 표시 칸이 아직 없습니다. ${ENROLLMENT_BLOCK_SQL_HINT}` });
        }
        const groups = groupBlockedStudentsByCohort(retry.data || [], cohorts, resolveCohortForDate);
        return Response.json({ ok: true, groups, total: (retry.data || []).length, warning: '표시한 기수 칸이 없어 표시일로 기수를 추정했습니다. beyond-os-supabase-enrollment-block-cohort-v41-268.sql 실행 여부를 확인하세요.' });
      }
      throw error;
    }
    const groups = groupBlockedStudentsByCohort(students || [], cohorts, resolveCohortForDate);
    return Response.json({ ok: true, groups, total: (students || []).length, warning: '' });
  } catch (error) {
    return Response.json({ ok: false, groups: [], total: 0, error: error.message || 'Unknown error' }, { status: 500 });
  }
}
