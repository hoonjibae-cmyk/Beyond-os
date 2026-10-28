// Beyond OS v41-280 — 학생 상벌점 누적 합계 (기수 기간 안)
export async function loadPointTotals(supabase, studentId, range = null) {
  try {
    let query = supabase
      .from('student_points')
      .select('point_type, points')
      .eq('student_id', String(studentId))
      .eq('is_deleted', false);
    if (range?.start) query = query.gte('point_date', range.start);
    if (range?.end) query = query.lte('point_date', range.end);
    const { data, error } = await query;
    if (error) throw error;
    const reward = (data || []).filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
    const penalty = (data || []).filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
    return { reward, penalty, net: reward - penalty, penaltyNet: penalty - reward, count: (data || []).length };
  } catch {
    return { reward: 0, penalty: 0, net: 0, penaltyNet: 0, count: 0, unavailable: true };
  }
}
