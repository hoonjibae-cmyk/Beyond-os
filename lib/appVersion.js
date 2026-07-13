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

export const APP_VERSION = 'v41-58';
export const APP_VERSION_NAME = '보안 강화 — 크론 잠금·서버 권한 게이트';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '보안 보강: ① 자동 하원(/api/auto-checkout) 크론 엔드포인트에 시크릿/세션 검증을 추가해 익명 호출을 차단(CRON_SECRET 권장). ② 민감 API(리포트 발송·주간리포트·상벌점·설정 저장 등 9개)에 화면 권한과 동일한 서버측 권한 게이트를 추가해, 로그인만으로 직접 호출하는 우회를 막았습니다.';
