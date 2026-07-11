# Beyond OS v41-09.1

The Place 26 · Beyond OS Supabase 저장형 대시보드입니다.

기준선: `beyond-os-v41-09-attendance-notification-policy.zip`에서 Vercel Hobby 배포 오류를 수정한 v41-09.1입니다.

## v41-09.1 배포 오류 수정

- 기존 v41-09의 `*/10 * * * *` Vercel Cron 때문에 Hobby 계정 배포가 차단되는 문제를 수정했습니다.
- `vercel.json`에는 하루 1회 자정 자동퇴실 Cron만 남겼습니다.
- 복귀 지연 점검은 MacroDroid에서 10분마다 `/api/attendance-return-overdue-check`를 호출하는 방식으로 사용합니다.
- 해당 API는 `x-kiosk-secret` 헤더로 `KIOSK_BRIDGE_SECRET` 값을 확인합니다.

## v41-09 핵심

- 기존 입실/퇴실 자동 알림을 `출결 자동 알림` 정책으로 확장했습니다.
- 리포트 발송 설정 화면에서 아래 항목을 직접 ON/OFF할 수 있습니다.
  - 입실 알림: 기본 ON
  - 퇴실 알림: 기본 ON
  - 외출 알림: 기본 OFF
  - 복귀 알림: 기본 OFF
  - 복귀 지연 알림: 기본 ON
  - 복귀 지연 기준: 기본 `복귀 예정시간 + 15분`
- 외출/복귀 알림도 기록방식을 함께 표기합니다.
  - 키오스크 자동기록
  - 관리자 수동기록
- 복귀 지연 알림은 학생 시간표의 외출 일정에 등록된 `복귀 예정시간`을 기준으로 판단합니다.
- 알림 로그 화면명을 `입퇴실 알림 로그`에서 `출결 알림 로그`로 확장했습니다.
- Vercel Hobby 계정 배포 제한을 피하기 위해 `/api/attendance-return-overdue-check` 10분 Vercel Cron을 제거했습니다. 복귀 지연 점검은 MacroDroid 외부 호출 매크로로 실행합니다.

## 기본 정책

| 알림 종류 | 기본값 | 설명 |
|---|---:|---|
| 입실 | ON | 입실 기록 생성 시 발송 |
| 퇴실 | ON | 퇴실 기록 생성 시 발송 |
| 외출 | OFF | 필요할 때만 켜서 사용 권장 |
| 복귀 | OFF | 필요할 때만 켜서 사용 권장 |
| 복귀 지연 | ON | 복귀 예정시간을 넘긴 학생만 알림 |

## 복귀 지연 알림 동작

```text
학생 시간표
외출 18:00 ~ 복귀 예정 18:30

설정
복귀 지연 기준: 15분

실제 상태
18:45 이후에도 학생 상태가 외출 중

결과
MacroDroid 외부 호출 매크로 점검 시 복귀 지연 알림 발송
```

단, 복귀 지연 알림은 아래 조건을 만족해야 합니다.

```text
1. 해당 날짜 학생 시간표에 외출 시작/복귀 예정이 등록되어 있음
2. 학생이 Beyond OS에서 현재 외출 상태임
3. 복귀 예정시간 + 설정 분을 초과함
4. 동일 학생/동일 예정복귀시간의 복귀 지연 알림이 아직 발송되지 않음
```

## 설정 위치

```text
설정 → 리포트 발송 설정 → 출결 자동 알림 ON/OFF
```

로그 확인 위치:

```text
설정 → 출결 알림 로그
```

## Supabase SQL

신규 테이블은 없습니다.

다만 `system_settings.report_send_settings`에 v41-09 기본값을 미리 넣고 싶다면 아래 선택 SQL을 실행하세요.

```text
beyond-os-supabase-report-send-settings-v41-09.sql
```

기존 필수 SQL은 그대로 유지합니다.

```text
beyond-os-supabase-kiosk-bridge-v41-05.sql
beyond-os-supabase-report-send-settings-v41-06.sql
beyond-os-supabase-attendance-notifications-v41-07.sql
beyond-os-supabase-kiosk-bridge-v41-08.sql
```

## Vercel / MacroDroid

Vercel Hobby 계정은 하루 1회보다 자주 실행되는 Cron을 허용하지 않습니다. 따라서 v41-09.1에서는 Vercel Cron에 자정 자동퇴실만 남기고, 복귀 지연 점검은 MacroDroid에서 외부 호출하도록 전환했습니다.

MacroDroid에 아래 매크로를 추가하세요.

```text
Trigger:
10분마다 반복 실행

Action:
HTTP Request

Method:
POST

URL:
https://현재배포주소/api/attendance-return-overdue-check

Headers:
x-kiosk-secret: KIOSK_BRIDGE_SECRET 값

Body:
비워둠
```

Vercel 환경변수는 새로 추가하지 않습니다. 다만 기존 출결 알림 템플릿은 이제 입실/퇴실뿐 아니라 외출/복귀/복귀 지연까지 커버할 수 있는 문구로 승인받는 것을 권장합니다.

```text
SOLAPI_TEMPLATE_ID_ATTENDANCE=SOLAPI에서 복사한 실제 출결 알림톡 템플릿 ID
```

권장 템플릿 예시:

```text
[The Place 26 #{출결구분} 알림]

#{학생명} 학생의 출결 상태가 기록되었습니다.

- 구분: #{출결구분}
- 기준시간: #{출결시간}
- 기록방식: #{기록방식}

목동유쌤영어학원
```

지원 변수:

```text
#{학생명}
#{날짜}
#{출결구분}
#{출결시간}
#{기록방식}
```

## 배포 명령

압축을 풀고 프로젝트 폴더에서 아래 명령으로 배포합니다.

```powershell
npx.cmd vercel --prod --yes
```

## 배포 후 확인

1. v41-09.1 deploy-fix zip 압축 해제
2. 필요 시 Supabase SQL Editor에서 `beyond-os-supabase-report-send-settings-v41-09.sql` 실행
3. 아래 명령으로 Vercel Production 재배포

```powershell
npx.cmd vercel --prod --yes
```

4. Beyond OS 접속
5. `설정 → 리포트 발송 설정` 이동
6. 출결 자동 알림 ON/OFF 카드 확인
7. 외출/복귀 알림은 운영 정책에 맞춰 ON/OFF 설정
8. 복귀 지연 기준이 15분인지 확인
9. MacroDroid에 복귀 지연 점검 HTTP Request 매크로 추가
10. `설정 → 출결 알림 로그`에서 로그 조회 확인

## 배포 메모

이 배포본은 Vercel `npm install` 실패 가능성을 줄이기 위해 `package-lock.json`, `node_modules`, `.next`를 포함하지 않습니다.
