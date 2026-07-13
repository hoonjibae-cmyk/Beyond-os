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

export const APP_VERSION = 'v41-62.2';
export const APP_VERSION_NAME = 'AI 기본 모델 gpt-5.4-mini 유지';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'AI 기능 기본 모델을 gpt-5.4-mini로 유지합니다(OPENAI_MODEL 환경변수가 있으면 우선 적용). AI 초안 실패 시 실제 사유(OpenAI 오류 메시지)를 화면에 함께 표시하고, temperature 미지원 모델을 위한 자동 재시도는 유지했습니다.';
