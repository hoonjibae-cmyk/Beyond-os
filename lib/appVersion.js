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

export const APP_VERSION = 'v41-38';
export const APP_VERSION_NAME = 'Apple-style UI (Light) · Phase 1';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '전체 화면 톤앤매너를 애플 스타일(뉴트럴 그레이·SF 타이포·부드러운 카드)로 정리했습니다(라이트 1차). 좌석 상태색: 외출=노랑, 미입실=연회색, 퇴실=진회색. 좌석 타일 확대·간격 축소. 기능·구조·상태 로직은 그대로입니다.';
