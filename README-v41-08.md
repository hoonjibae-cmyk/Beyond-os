# Beyond OS v41-08

The Place 26 · Beyond OS Supabase 저장형 대시보드입니다.

기준선: `beyond-os-v41-07-attendance-notification-automation.zip`에서 이어진 v41-08입니다.

## v41-08 핵심

- 자정 시스템 자동퇴실은 기존처럼 내부 마감 처리만 수행합니다.
- 자정 자동퇴실 자체로는 학부모 퇴실 알림톡을 발송하지 않습니다.
- 자정 이후 설정된 보정 허용 시간 안에 실제 키오스크 퇴실 문자가 들어오면, 전날 세션의 실제 퇴실시간으로 보정합니다.
- 이 실제 키오스크 퇴실 보정 시점에는 퇴실 알림톡을 발송합니다.
- 알림톡 기록방식은 `키오스크 자동기록`으로 표시됩니다.
- 동일한 자정 이후 실제 퇴실 문자가 다시 들어오면 중복으로 무시합니다.

## 기본 동작 예시

```text
23:40 학생이 실제로는 아직 스터디카페 안에 있음
00:00 Beyond OS 시스템 자동퇴실 처리
      → 내부 마감 처리만 진행
      → 학부모 퇴실 알림 없음
00:08 학생이 실제로 키오스크에서 퇴실
      → 전날 세션의 퇴실시간을 00:08로 보정
      → 학부모 퇴실 알림 발송
      → 기록방식: 키오스크 자동기록
```

## 설정 위치

```text
설정 → 키오스크 브릿지 → Heartbeat / 운영시간 감시 설정
```

추가된 항목은 아래와 같습니다.

```text
자정 이후 실제 퇴실 보정 사용: ON/OFF
자정 이후 실제 퇴실 보정 허용(분): 기본 60분
```

권장값은 60분입니다. 00:00~01:00 사이의 실제 키오스크 퇴실 문자를 전날 세션 퇴실로 보정합니다.

## 알림 발송 기준

| 상황 | 퇴실 알림톡 |
|---|---|
| 00:00 시스템 자동퇴실 | 발송 안 함 |
| 00:00 이후 보정 허용 시간 안의 실제 키오스크 퇴실 | 발송 |
| 보정 허용 시간 이후의 키오스크 퇴실 | 기존 상태검사 기준으로 처리, 일반적으로 실패 로그 |
| 관리자 수동 퇴실 | v41-07 기준대로 발송 |

## Supabase SQL

v41-08은 신규 테이블이 없습니다.

다만 `system_settings.kiosk_bridge_settings`에 자정 이후 퇴실 보정 설정 기본값을 미리 넣고 싶다면 아래 선택 SQL을 실행하세요.

```text
beyond-os-supabase-kiosk-bridge-v41-08.sql
```

이미 `system_settings`가 있고 Beyond OS 설정 화면에서 저장이 잘 된다면 필수는 아닙니다.

## 기존 필수 SQL

v41-07까지 아직 적용하지 않았다면 아래 SQL은 필요합니다.

```text
beyond-os-supabase-kiosk-bridge-v41-05.sql
beyond-os-supabase-report-send-settings-v41-06.sql
beyond-os-supabase-attendance-notifications-v41-07.sql
```

## Vercel / MacroDroid

추가 환경변수는 없습니다.

기존 설정을 그대로 사용합니다.

```text
KIOSK_BRIDGE_SECRET
SOLAPI_TEMPLATE_ID_ATTENDANCE
KAKAO_RECIPIENT_TEST_MODE 또는 리포트 발송 설정 테스트모드
```

MacroDroid의 문자/Heartbeat 매크로도 변경하지 않습니다.

## 배포 후 확인

1. v41-08 zip을 Vercel Production에 재배포
2. 설정 → 키오스크 브릿지 이동
3. 자정 이후 실제 퇴실 보정 사용 ON 확인
4. 보정 허용 시간을 60분으로 저장
5. 테스트모드 ON 상태에서 자정 이후 퇴실 테스트 또는 수신 로그 재처리 테스트
6. 입퇴실 알림 로그에서 퇴실 알림이 `키오스크 자동기록`으로 남는지 확인

## 배포 메모

이 배포본은 Vercel `npm install` 실패 가능성을 줄이기 위해 `package-lock.json`, `node_modules`, `.next`를 포함하지 않습니다.
