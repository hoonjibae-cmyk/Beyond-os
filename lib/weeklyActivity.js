// Beyond OS v41-288 — 그 주에 "개인 시간표도 없고 등원 기록도 없는" 학생 판별
//
// 위클리 리포트 발송 기준: 아래 두 가지가 모두 해당하면 그 주 리포트는 보내지 않습니다.
//   1) 그 주(월~일)에 student_daily_schedules 행이 하나도 없음 (결석 등록 행도 '설정됨'으로 봅니다)
//   2) 그 주 daily_sessions 에 등원(check_in_at) 또는 결석 처리(seat_status='absent') 기록이 하나도 없음
// 둘 중 하나라도 있으면 평소대로 보냅니다. (시간표만 있고 전부 미등원이면 '미등원 N일' 리포트가 의미 있음)
//
// 자동 발송·전체 발송 창·개별 발송이 모두 이 함수를 써서 기준이 어긋나지 않게 합니다.

import { selectInChunksSafe } from './supabaseChunk';

export const WEEKLY_NO_ACTIVITY_CODE = 'WEEKLY_NO_ACTIVITY';
export const WEEKLY_NO_ACTIVITY_MESSAGE = '이번 주 개인 시간표가 없고 등원 기록도 없어 위클리 리포트를 보내지 않습니다.';

function hasAttendanceRecord(session) {
  return Boolean(session?.check_in_at) || String(session?.seat_status || '') === 'absent';
}

/**
 * @returns {{ inactiveIds: Set<string>, scheduledIds: Set<string>, attendedIds: Set<string>, warning: string }}
 */
export async function findWeeklyInactiveStudentIds(supabase, studentIds = [], week = {}) {
  const ids = [...new Set((studentIds || []).map(String).filter(Boolean))];
  const result = { inactiveIds: new Set(), scheduledIds: new Set(), attendedIds: new Set(), warning: '' };
  if (!ids.length || !week?.start || !week?.end) return result;

  const schedules = await selectInChunksSafe(ids, (part) => supabase
    .from('student_daily_schedules')
    .select('student_id')
    .in('student_id', part)
    .gte('schedule_date', week.start)
    .lte('schedule_date', week.end));
  const sessions = await selectInChunksSafe(ids, (part) => supabase
    .from('daily_sessions')
    .select('student_id, check_in_at, seat_status')
    .in('student_id', part)
    .gte('session_date', week.start)
    .lte('session_date', week.end));

  // 조회 자체가 실패하면 아무도 제외하지 않습니다. (기준을 확인 못 했는데 발송을 막지 않기 위해)
  if (schedules.error || sessions.error) {
    result.warning = `시간표·등원 기록을 확인하지 못해 제외 없이 진행합니다: ${schedules.error?.message || sessions.error?.message || ''}`.trim();
    return result;
  }

  for (const row of schedules.rows || []) result.scheduledIds.add(String(row.student_id));
  for (const row of sessions.rows || []) if (hasAttendanceRecord(row)) result.attendedIds.add(String(row.student_id));
  for (const id of ids) if (!result.scheduledIds.has(id) && !result.attendedIds.has(id)) result.inactiveIds.add(id);
  return result;
}

export async function isStudentInactiveForWeek(supabase, studentId, week = {}) {
  const found = await findWeeklyInactiveStudentIds(supabase, [studentId], week);
  return { inactive: found.inactiveIds.has(String(studentId)), warning: found.warning };
}

/** 순수 함수 (테스트용): 행 목록으로 판별 */
export function computeInactiveIds(studentIds = [], scheduleRows = [], sessionRows = []) {
  const scheduled = new Set((scheduleRows || []).map((row) => String(row.student_id)));
  const attended = new Set((sessionRows || []).filter(hasAttendanceRecord).map((row) => String(row.student_id)));
  return new Set((studentIds || []).map(String).filter((id) => !scheduled.has(id) && !attended.has(id)));
}
