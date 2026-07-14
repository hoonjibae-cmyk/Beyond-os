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

export const APP_VERSION = 'v41-66';
export const APP_VERSION_NAME = '공지사항 알림톡 일괄 발송';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '설정 › 공지사항 발송 추가: 공지를 인앱으로 작성(공지 페이지 /n/token 자동 생성)하거나 외부 URL을 붙여넣어, 활성 학생의 수신 동의 보호자 전체에게 카카오 알림톡(공지 템플릿)으로 링크를 일괄 발송합니다. 테스트 수신번호 모드·Allowlist·대상 확인 2단계 안전장치를 그대로 적용합니다. (notices 테이블 SQL + SOLAPI_TEMPLATE_ID_NOTICE 설정 필요)';
