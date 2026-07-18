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

export const APP_VERSION = 'v41-75.1';
export const APP_VERSION_NAME = '속도 개선 (Vercel 리전 도쿄 고정)';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'Vercel 서버리스 함수 리전을 Supabase(도쿄 ap-northeast-1)와 동일한 도쿄(hnd1)로 고정해 DB 왕복 지연을 줄였습니다. 대시보드 자동 새로고침 주기는 기존 3초를 그대로 유지합니다.';
