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

export const APP_VERSION = 'v41-57';
export const APP_VERSION_NAME = '학습 관리 탭 사전 설문 업로드';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = '학습 관리 탭 Phase 2: 학생·학부모 사전 설문(구글폼 응답 엑셀)을 bulk 업로드하면 학생 이름으로 자동 매칭되어, 선택한 학생의 설문이 탭 안에서 섹션별로 표시됩니다. (student_surveys 테이블 SQL을 먼저 실행하세요.)';
