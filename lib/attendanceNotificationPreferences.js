export const STUDENT_ATTENDANCE_NOTIFICATION_PREFERENCES_TABLE = 'student_attendance_notification_preferences';

export const ATTENDANCE_PREFERENCE_COLUMNS = {
  check_in: 'exclude_check_in',
  check_out: 'exclude_check_out',
  away: 'exclude_away',
  return: 'exclude_return',
  return_overdue: 'exclude_return_overdue',
};

export function normalizeAttendancePreferenceRow(row = {}) {
  return {
    student_id: row.student_id || null,
    exclude_check_in: Boolean(row.exclude_check_in),
    exclude_check_out: Boolean(row.exclude_check_out),
    exclude_away: Boolean(row.exclude_away),
    exclude_return: Boolean(row.exclude_return),
    exclude_return_overdue: Boolean(row.exclude_return_overdue),
    memo: row.memo || '',
    updated_at: row.updated_at || null,
  };
}

export function isEventExcludedByPreference(eventType, preference = {}) {
  const column = ATTENDANCE_PREFERENCE_COLUMNS[eventType];
  if (!column) return false;
  return Boolean(preference?.[column]);
}

export async function getStudentAttendanceNotificationPreference(supabase, studentId) {
  if (!studentId) return { preference: normalizeAttendancePreferenceRow({}), exists: false, warning: null };

  try {
    const { data, error } = await supabase
      .from(STUDENT_ATTENDANCE_NOTIFICATION_PREFERENCES_TABLE)
      .select('*')
      .eq('student_id', studentId)
      .maybeSingle();

    if (error) throw error;

    return {
      preference: normalizeAttendancePreferenceRow(data || { student_id: studentId }),
      exists: Boolean(data),
      warning: null,
    };
  } catch (error) {
    // SQL을 아직 실행하지 않은 환경에서는 자동 알림 자체를 막지 않습니다.
    return {
      preference: normalizeAttendancePreferenceRow({ student_id: studentId }),
      exists: false,
      warning: error?.message || '학생별 출결 알림 제외 설정 조회 실패',
    };
  }
}

export async function upsertStudentAttendanceNotificationPreference(supabase, studentId, patch = {}) {
  if (!studentId) throw new Error('studentId is required');

  const payload = {
    student_id: studentId,
    exclude_check_in: Boolean(patch.exclude_check_in),
    exclude_check_out: Boolean(patch.exclude_check_out),
    exclude_away: Boolean(patch.exclude_away),
    exclude_return: Boolean(patch.exclude_return),
    exclude_return_overdue: Boolean(patch.exclude_return_overdue),
    memo: String(patch.memo || '').trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(STUDENT_ATTENDANCE_NOTIFICATION_PREFERENCES_TABLE)
    .upsert(payload, { onConflict: 'student_id' })
    .select('*')
    .single();

  if (error) throw error;
  return normalizeAttendancePreferenceRow(data || payload);
}
