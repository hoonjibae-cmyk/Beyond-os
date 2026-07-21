// ─────────────────────────────────────────────────────────────
// Beyond OS 앱 버전 (단일 관리 파일)
//
// 재배포할 때는 아래 APP_VERSION 값만 올리면
// 앱 화면 헤더의 "버전" 배지와 /api/health 응답에 자동 반영됩니다.
// (package.json 의 version/name 은 npm 메타데이터일 뿐 화면에는 표시되지 않습니다.
//  가급적 같은 번호로 맞춰두면 관리가 편합니다.)
//
// 버전 표기 규칙 예시
//   - 큰 작업 라인:  v41-37, v41-38 ...
//   - 후속 패치:     v41-37.1, v41-37.2 ...
// ─────────────────────────────────────────────────────────────

export const APP_VERSION = 'v41-94';
export const APP_VERSION_NAME = '첫 등원은 쉬는 시간 HOLD 제외';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '그 날 아직 출결 기록이 없는 학생의 첫 등원(입실) 키오스크 신호는 쉬는 시간이라도 HOLD 목록으로 보내지 않고 바로 출결로 반영합니다. (이미 등원한 학생의 외출·복귀·재입실·퇴실 신호는 기존처럼 쉬는 시간 HOLD 적용)';
