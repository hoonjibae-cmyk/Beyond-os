// Beyond OS v41-227 — 요청이 보고 있는 기수로 대상을 좁히는 공용 도구
//
// 화면 위쪽 [기수 보기]가 모든 요청에 x-beyond-cohort-id 를 실어 보냅니다.
// 서버에서 '이번 기수 학생만'을 골라야 하는 곳이 여러 군데라 여기로 모았습니다.
// (v41-202 공지 발송에서 쓰던 것을 그대로 옮겨 왔습니다)
//
// 왜 중요한가
//   기수가 바뀌어도 지난 기수 학생은 students.status 가 active 로 남아 있습니다.
//   그래서 'status !== inactive' 만으로 거르면 지난 기수 학부모에게까지 나갑니다.
//   실제로 위클리 전체 발송 대상이 26명이어야 하는데 38명으로 잡혔습니다.

export function getCohortIdFromRequest(request) {
  try {
    return String(request?.headers?.get?.('x-beyond-cohort-id') || '').trim();
  } catch {
    return '';
  }
}

/**
 * 요청에 기수가 없으면(=전체 보기) 오늘이 속한 기수를, 그것도 없으면 가장 최근 기수를 씁니다.
 * 기수를 아직 하나도 만들지 않았다면 null 을 돌려주고 호출한 쪽이 예전처럼 전원을 대상으로 둡니다.
 */
export async function resolveScopeCohort(supabase, requested, today) {
  let rows = [];
  try {
    const { data, error } = await supabase
      .from('cohorts')
      .select('id, name, start_date, end_date')
      .order('start_date', { ascending: true });
    if (error) throw error;
    rows = data || [];
  } catch {
    return null;
  }
  if (!rows.length) return null;

  const wanted = String(requested || '').trim();
  const picked = wanted ? rows.find((row) => String(row.id) === wanted) : null;
  if (picked) return { id: String(picked.id), name: picked.name || '' };

  // 기간이 겹치면 나중에 시작한 기수를 씁니다. (cohorts 는 시작일 오름차순)
  const current = [...rows].reverse().find((row) => (
    String(row.start_date || '').slice(0, 10) <= today && today <= String(row.end_date || '').slice(0, 10)
  ));
  if (current) return { id: String(current.id), name: current.name || '' };

  const latest = rows[rows.length - 1];
  return { id: String(latest.id), name: latest.name || '' };
}

/**
 * 기수 수강 명단(활성)의 학생 id.
 *
 * 명단을 못 읽으면 null 을 돌려줍니다. 빈 배열(=명단 0명)과 반드시 구분해야 합니다.
 * 빈 명단을 '조건 없음'으로 흘려보내면 전 기수 학부모에게 발송됩니다.
 */
export async function loadCohortStudentIds(supabase, cohortId) {
  if (!cohortId) return null;
  const { data, error } = await supabase
    .from('cohort_students')
    .select('student_id')
    .eq('cohort_id', cohortId)
    .eq('is_active', true);
  if (error) throw error;
  return [...new Set((data || []).map((row) => String(row.student_id)))];
}
