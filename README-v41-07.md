# Beyond OS v41-07

The Place 26 · Beyond OS Supabase 저장형 대시보드입니다.

기준선: `beyond-os-v41-06-report-period-mapping-test-mode.zip`에서 이어진 v41-07입니다.

## v41-07 핵심

- 비욘드OS에 `입실(check_in)` 또는 `퇴실(check_out)` 출결 이벤트가 생성될 때 자동으로 입퇴실 알림톡 발송 요청
- 알림톡 본문에 `기록방식` 표기
  - 키오스크 자동기록
  - 관리자 수동기록
- 외출/복귀 알림은 이번 버전 범위에서 제외
- v41-06 리포트 발송 테스트모드 ON/OFF 설정과 연동
  - 테스트모드 ON이면 테스트 수신번호로 대체
  - 테스트모드 OFF이면 보호자 연락처 기준 발송
- 학생 보호자 연락처는 `student_guardians`를 우선 사용하고, 없으면 `students.parent_phone`을 fallback으로 사용
- 입퇴실 알림 발송 로그 화면 추가
  - 위치: `설정 → 입퇴실 알림 로그`
- 동일 학생·출결종류·날짜·시각·기록방식 기준 중복 발송 방지

## 자동 발송 대상

이번 버전의 자동 발송 대상은 아래 두 가지뿐입니다.

```text
입실 check_in
퇴실 check_out
```

아래 항목은 다음 단계에서 별도로 설계합니다.

```text
외출 away
복귀 return
결석 absent
학습상태 입력
```

## 알림톡 문구 예시

```text
[The Place 26 입실 알림]

홍길동 학생이 입실했습니다.

- 입실시간: 09:04
- 기록방식: 키오스크 자동기록

목동유쌤영어학원
```

수동 기록이면 `기록방식: 관리자 수동기록`으로 표시됩니다.

## Supabase 필수 SQL

v41-07은 발송 로그 테이블이 필요합니다. Supabase SQL Editor에서 아래 파일을 실행하세요.

```text
beyond-os-supabase-attendance-notifications-v41-07.sql
```

이 SQL은 아래 테이블을 추가합니다.

```text
attendance_notification_logs
```

## 기존 필수 SQL

v41-05/v41-06을 아직 적용하지 않았다면 아래 SQL도 필요합니다.

```text
beyond-os-supabase-kiosk-bridge-v41-05.sql
beyond-os-supabase-operating-rules-v40-6.sql
```

## Vercel 환경변수

SOLAPI Adapter를 사용하는 경우 입퇴실 템플릿 ID를 추가하세요.

```text
SOLAPI_TEMPLATE_ID_ATTENDANCE=입퇴실_알림톡_templateId
```

Direct Kakao Adapter를 직접 쓰는 경우 아래 값을 사용할 수 있습니다.

```text
KAKAO_TEMPLATE_CODE_ATTENDANCE=입퇴실_템플릿코드
```

기존 설정은 그대로 사용합니다.

```text
KAKAO_PROVIDER_MODE=solapi 또는 kakao 또는 mock
KAKAO_FAIL_SAFE_MODE=true/false
KAKAO_RECIPIENT_TEST_MODE=true/false
KAKAO_TEST_RECIPIENT_PHONE=테스트번호
```

운영 전에는 `KAKAO_FAIL_SAFE_MODE=true`, 테스트모드 ON 상태에서 로그가 정상 생성되는지 먼저 확인하는 것을 권장합니다.

## 배포 후 확인

1. Supabase에서 `beyond-os-supabase-attendance-notifications-v41-07.sql` 실행
2. Vercel Production 재배포
3. 설정 → 리포트 발송 설정에서 입퇴실 템플릿 상태 확인
4. 설정 → 입퇴실 알림 로그 화면 확인
5. 테스트모드 ON 상태에서 입실/퇴실 수동 변경 또는 키오스크 입퇴실 테스트
6. 알림 로그에 기록방식, 수신자, 발송상태가 남는지 확인
7. 실제 발송 전 테스트번호 1개로 수신 확인

## 배포 메모

이 배포본은 Vercel `npm install` 실패 가능성을 줄이기 위해 `package-lock.json`, `node_modules`, `.next`를 포함하지 않습니다.
