// Beyond OS v41-263 — 학생별 담당 멘토 정리
//
// mentoring_mentor_students(멘토 ↔ 학생 연결) 행 목록에서 학생별 담당 멘토 이름을 만듭니다.
// 연결은 기수(cohort_id)별로 따로 두므로, 오늘이 속한 기수의 연결을 먼저 쓰고
// 기수 표시가 없는(옛) 연결은 그 기수에 연결이 하나도 없을 때만 씁니다.
// 한 학생에게 멘토가 둘 이상이면 이름을 모두 남깁니다(정렬 순서 → 이름순).

export function buildMentorByStudent(rows = [], cohortId = null) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && row.is_active !== false && row.student_id);
  const wanted = cohortId ? String(cohortId) : '';
  const inCohort = wanted ? list.filter((row) => String(row.cohort_id || '') === wanted) : [];
  const legacy = list.filter((row) => !row.cohort_id);
  const source = inCohort.length ? inCohort : (wanted ? legacy : list);

  const byStudent = {};
  for (const row of source) {
    const mentor = row.mentoring_mentors || {};
    const name = String(mentor.mentor_name || row.mentor_name || '').trim();
    if (!name) continue;
    const key = String(row.student_id);
    if (!byStudent[key]) byStudent[key] = [];
    if (byStudent[key].some((item) => item.mentorId === String(row.mentor_id || mentor.id || ''))) continue;
    byStudent[key].push({
      mentorId: String(row.mentor_id || mentor.id || ''),
      mentorName: name,
      sortOrder: Number(mentor.sort_order || 0),
    });
  }
  for (const key of Object.keys(byStudent)) {
    byStudent[key].sort((a, b) => a.sortOrder - b.sortOrder || a.mentorName.localeCompare(b.mentorName, 'ko'));
  }
  return byStudent;
}

/** 화면 표시용: '김멘토' / '김멘토 · 이멘토' / '' */
export function formatMentorNames(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((item) => item.mentorName).filter(Boolean).join(' · ');
}
