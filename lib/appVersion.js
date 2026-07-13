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

export const APP_VERSION = 'v41-62.1';
export const APP_VERSION_NAME = 'AI 호출 진단·temperature 재시도';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'AI 초안이 규칙 기반으로 대체될 때 실제 사유(OpenAI 오류 메시지)를 화면에 함께 표시하도록 개선했습니다. 또한 gpt-5 계열 등 사용자 지정 temperature를 거부하는 모델을 위해, 실패 시 temperature 없이 1회 자동 재시도하도록 주간 총평·면담 다듬기·상담 요약 3개 API를 보강했습니다.';
