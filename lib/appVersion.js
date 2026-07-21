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

export const APP_VERSION = 'v41-100';
export const APP_VERSION_NAME = '폴링 비용 최적화 (탭별 주기)';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'Vercel 서버 비용(Fluid Active CPU) 절감: 실시간 좌석·알림이 필요한 메인 대시보드 탭에서만 3초 폴링을 유지하고, 그 외 탭(시간표·학습관리·랭킹보드 등)에서는 30초로 완화했습니다. 백그라운드 탭은 기존대로 요청을 생략합니다.';
