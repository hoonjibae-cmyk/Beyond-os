# Beyond OS v41-24 — 위클리 리포트 자동 구성 콘솔

기준선: v41-23 `beyond-os-v41-23-public-report-mobile-polish.zip`

## 핵심 변경

1. `위클리 리포트` 화면에 `주간 리포트 자동 구성 콘솔`을 추가했습니다.
2. 활성 학생 전체 또는 아직 저장된 위클리 리포트가 없는 학생을 대상으로 주간 리포트 초안을 자동 생성합니다.
3. 자동 구성 기준 데이터는 다음과 같습니다.
   - 주간 출결 기록
   - 순공시간
   - 외출 횟수/시간
   - 지각/조퇴/결석/미등원/순공부족 등 운영 기준 확인사항
   - 상벌점 기록
4. 기존 저장 리포트가 있는 경우 `전체 갱신 구성`은 기존 주간면담/최종 코멘트는 보존하고, 최신 주간 데이터 기준으로 요약과 리포트 본문을 갱신합니다.
5. `미작성 자동 구성`은 이미 저장된 리포트는 건너뛰고 미작성 학생만 생성합니다.
6. 자동 구성 결과는 신규 생성/기존 갱신/건너뜀/실패 인원으로 요약 표시됩니다.
7. 자동 구성 작업은 `user_action_logs`에 `weekly_report.bulk_compose`로 기록됩니다.

## 추가 API

- `POST /api/weekly-report-bulk-compose`

요청 예시:

```json
{
  "startDate": "2026-07-06",
  "endDate": "2026-07-12",
  "mode": "missing"
}
```

지원 mode:

- `missing`: 미작성 학생만 자동 구성
- `all`: 전체 활성 학생 갱신 구성
- `selected`: 지정 학생만 구성

## Supabase / Vercel / MacroDroid

추가 설정 없음.

단, 기존 위클리 리포트 테이블은 필요합니다.

- `beyond-os-supabase-weekly-reports-v40-10.sql`
- `beyond-os-supabase-weekly-send-status-v40-25.sql`

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
