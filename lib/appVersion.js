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

export const APP_VERSION = 'v41-70';
export const APP_VERSION_NAME = '공지 알림톡 목적별(카테고리) 템플릿';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '공지사항 발송에 목적별 카테고리(운영규정·운영시간 변동 안내·환불규정)를 추가했습니다. 카테고리를 고르면 유형에 맞는 입력(링크형 또는 기간/사유/내용 필드형)과 SOLAPI 등록용 템플릿 예시가 나타나고, 카테고리별 승인 템플릿(SOLAPI_TEMPLATE_ID_NOTICE_*)으로 자동 매핑되어 발송됩니다. (beyond-os-supabase-notices-categories-v41-70.sql 실행 필요)';
