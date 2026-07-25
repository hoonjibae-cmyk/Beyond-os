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

export const APP_VERSION = 'v41-120';
export const APP_VERSION_NAME = '대시보드 폴링 3초 → 6초 (서버 비용 절감)';
export const APP_VERSION_SUBTITLE = 'The Place 26 · Supabase 저장형 대시보드';
export const APP_VERSION_DESCRIPTION = 'Vercel 사용량(Fast Origin Transfer · Fluid Active CPU · Function Invocations) 절감을 위해 메인 대시보드의 자동 갱신 주기를 3초에서 6초로 늘렸습니다. 좌석배치도·알림센터 갱신 요청 수가 절반으로 줄어듭니다. 좌석 클릭·출결 저장 등 사용자 조작 시에는 기존과 동일하게 즉시 갱신되며, 다른 탭(30초)과 백그라운드 탭 요청 생략 정책은 그대로 유지됩니다.';
