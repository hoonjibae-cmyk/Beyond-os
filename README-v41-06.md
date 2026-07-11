# Beyond OS v41-06

The Place 26 · Beyond OS Supabase 저장형 대시보드입니다.

기준선: `beyond-os-v41-05-kiosk-import-recovery-console-deploy-fix.zip`에서 이어진 v41-06입니다.

## v41-06 핵심

- 기존 데일리 리포트 디자인과 문구 구조는 유지
- 순찰 체크 기록을 해당 체크 시간이 속한 차시 전체 구간으로 매핑
  - 예: `10:15 수학 / 문제풀이` → `1차시 09:00~11:00 - 수학 / 문제풀이`
- 관리자 코멘트는 기존 자유양식 유지
- 데일리 리포트 탭 안에 `원장 내부 확인` 화면 추가
  - 순공시간 부족, 외출 과다, 하원 미처리, 학습 상태 기록 없음, 수면/비학습, 코멘트 없음 등을 Beyond OS 내부에서 확인
  - 이 화면은 학부모 발송용 리포트가 아니며 카카오톡으로 발송되지 않음
- 리포트 발송 설정 화면에 `테스트모드 ON/OFF` 버튼 추가
  - 화면에서 저장한 값은 `system_settings.report_send_settings`에 저장
  - 화면 설정값이 있으면 기존 환경변수 `KAKAO_RECIPIENT_TEST_MODE`보다 우선 적용

## Supabase

신규 테이블은 없습니다.

단, 리포트 발송 테스트모드 ON/OFF 저장에는 기존 `system_settings` 테이블이 필요합니다. 이미 아래 SQL을 실행한 환경이면 추가 필수 작업은 없습니다.

```text
beyond-os-supabase-operating-rules-v40-6.sql
```

선택적으로 기본 설정 행을 미리 만들려면 아래 SQL을 실행할 수 있습니다.

```text
beyond-os-supabase-report-send-settings-v41-06.sql
```

이 선택 SQL은 기존 설정을 덮어쓰지 않고, 값이 없을 때만 `recipientTestMode: null` 기본 행을 만듭니다.

## Vercel / MacroDroid

- Vercel 환경변수 추가 없음
- MacroDroid 설정 변경 없음
- 배포용 zip에는 `package-lock.json`을 포함하지 않습니다.

## 배포 후 확인

1. Vercel Production 재배포
2. Beyond OS → 데일리 리포트 → `원장 내부 확인` 탭 확인
3. 데일리 리포트 미리보기에서 순찰 기록이 차시 구간 기준으로 표시되는지 확인
4. Beyond OS → 설정 → 리포트 발송 설정 → 테스트모드 ON/OFF 버튼 확인
5. 테스트모드 변경 후 연결 상태 새로고침하여 설정 기준이 `Beyond OS 화면 설정`으로 표시되는지 확인
