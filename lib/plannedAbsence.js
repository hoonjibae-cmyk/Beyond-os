// v41-281: 시간표에 '결석'으로 등록된 날(planned_absent) 판별.
//
// 결석 예정으로 등록해도 planned_check_in/out 은 그대로 남기 때문에,
// 결석 예정인 학생이 잠깐 들러 공부하고 가면 예정 등원보다 늦었다는 이유로
// 데일리 리포트·출결 이력·좌석 패널에 "지각"(또는 "조퇴")이 찍혔습니다.
// 결석으로 미리 신고한 날은 그 시간표를 등하원 기준으로 쓰지 않습니다.
export function isPlannedAbsentSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return false;
  return Boolean(schedule.planned_absent ?? schedule.plannedAbsent);
}
