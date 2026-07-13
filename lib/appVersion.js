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

export const APP_VERSION = 'v41-59';
export const APP_VERSION_NAME = '앱 아이콘 리뉴얼 — 브랜드 왕관';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'The Place 26 브랜드 왕관을 활용해 앱 아이콘(파비콘·홈화면·PWA)을 그래파이트+골드 왕관+BEYOND 워드마크로 리뉴얼했습니다. 192/512/apple-touch/maskable 아이콘과 테마 컬러를 모두 교체했습니다.';
