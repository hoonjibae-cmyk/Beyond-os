# Beyond OS v41-21

## Alimtalk Safe Test Send Console

기준선: v41-20 `beyond-os-v41-20-alimtalk-template-console.zip`

### 핵심 변경

1. `설정 → 알림톡 템플릿 관리`에서 템플릿별 테스트 발송 버튼 추가
   - 데일리 리포트
   - 위클리 리포트
   - 출결 자동 알림
   - 학부모 확인 요청

2. 테스트 발송은 테스트 수신번호로만 발송되도록 강제
   - `KAKAO_TEST_RECIPIENT_PHONE` 또는 `KAKAO_TEST_RECIPIENT_PHONES` 필요
   - 실제 학부모 번호를 사용하지 않음

3. 실전 발송 가능 여부 최종 판정 표시
   - 설정 필요
   - 테스트번호 필요
   - API 설정 필요
   - 테스트만 가능
   - 테스트 발송 가능
   - 실전 발송 가능

4. 테스트모드 OFF 전환 확인창 강화
   - 실제 보호자 연락처 발송 가능성 안내
   - 실전 전환 전 최종 확인 문구 강화

5. 테스트 발송 결과 로그 저장
   - `user_action_logs`에 `alimtalk_template.test_send` 기록
   - 실제 provider 처리 결과는 기존 `kakao_webhook.*` 로그에도 저장

6. 리포트 발송 설정 / 알림톡 템플릿 관리 중복 정리
   - `리포트 발송 설정`: 테스트모드, 출결 알림 ON/OFF, Fail-safe 등 운영 정책 중심
   - `알림톡 템플릿 관리`: 템플릿 상태, 필수 변수, 테스트 payload, 실제 테스트 발송 중심

### 신규 API

- `POST /api/alimtalk-test-send`
  - 인증 필요
  - body: `{ "reportType": "daily" | "weekly" | "attendance" | "parent_confirmation" }`
  - 테스트 수신번호가 없으면 400 반환
  - 템플릿 ID/코드가 없으면 400 반환
  - 내부적으로 `/api/kakao-send-webhook`을 호출하여 기존 Provider Adapter 흐름을 재사용

### 추가 SQL

없음.

### 추가 환경변수

없음.

단, 테스트 발송을 위해 기존 테스트 수신번호 환경변수는 필요합니다.

```text
KAKAO_TEST_RECIPIENT_PHONE=010xxxxxxxx
```

또는

```text
KAKAO_TEST_RECIPIENT_PHONES=010xxxxxxxx,010yyyyyyyy
```

### 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
