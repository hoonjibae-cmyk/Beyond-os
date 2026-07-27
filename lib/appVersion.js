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

export const APP_VERSION = 'v41-129';
export const APP_VERSION_NAME = '학습멘토 코멘트 작성자 표시';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '메인 대시보드 우측 "학습멘토 코멘트"에 저장된 코멘트가 있으면 어떤 멘토가 작성했는지 로그인 계정 기준으로 표시합니다(작성자 + 저장 시각). 기존 created_by 값은 리포트 생성·발송 등 다른 작업에서도 갱신되어 작성자를 정확히 나타내지 못하므로, 코멘트 전용 작성자/시각 컬럼을 새로 사용합니다. 적용하려면 beyond-os-supabase-mentor-comment-author-v41-129.sql 을 Supabase에서 실행하세요. SQL 실행 전에도 앱은 정상 동작하며, 이 경우 기존 기록자(created_by)를 대신 표시합니다.';
