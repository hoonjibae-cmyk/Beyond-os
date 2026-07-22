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

export const APP_VERSION = 'v41-101.1';
export const APP_VERSION_NAME = '발송이력 완료 집계 정확화';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '리포트 발송 이력에서 실제 발송건이 계속 「발송 대기(미발송)」로 잡히던 문제를 해결했습니다. 서버가 통신사 접수(received)를 내부적으로 status:ready로 저장하지만, 발송 이벤트(action_type=.send/.manual_sent)면 이미 발송된 것이므로 「발송 완료」로 판정합니다. 실제 미발송 초안(.prepare)만 「발송 대기(미발송)」로 표시됩니다.';
