# Beyond OS v40-117 Android 키오스크 브릿지 설정 가이드

## 1. Beyond OS 서버 설정

1. Vercel 프로젝트 → Settings → Environment Variables로 이동합니다.
2. `KIOSK_BRIDGE_SECRET`을 추가합니다.
3. 충분히 긴 랜덤 문자열을 값으로 넣습니다.
4. 환경변수 추가 후 Production 재배포를 실행합니다.

```powershell
cd C:\BeyondOS-current
npx.cmd vercel --prod --yes
```

## 2. Beyond OS 전송 URL

운영 주소가 `https://beyond-os-v31.vercel.app`라면 안드로이드 자동화 앱이 전송할 주소는 아래입니다.

```text
https://beyond-os-v31.vercel.app/api/kiosk-attendance-bridge
```

## 3. HTTP 요청 구조

### Method

```text
POST
```

### Headers

```text
Content-Type: application/json
x-kiosk-secret: Vercel에 넣은 KIOSK_BRIDGE_SECRET 값
```

### JSON Body

```json
{
  "rawText": "목동유쌤영어학원 김민준 님이 입장했습니다.",
  "sourceDeviceId": "kakao-bridge-phone-01",
  "idempotencyKey": "알림마다_고유한_값_권장"
}
```

`idempotencyKey`는 중복 처리 방지용입니다. 자동화 앱에서 만들기 어렵다면 비워도 서버가 자동 생성합니다.

## 4. 실제 알림톡 문구

```text
목동유쌤영어학원 김민준 님이 입장했습니다.
목동유쌤영어학원 김민준 님이 외출했습니다. 사유: 타학원 수업
목동유쌤영어학원 김민준 님이 퇴장했습니다. 재원시간: 5시간 20분
목동유쌤영어학원 김민준 님이 재입장을 했습니다.
```

Beyond OS는 위 문구를 기준으로 입실/외출/퇴실/재입장으로 자동 매핑합니다.

## 5. MacroDroid 기본 설정 흐름

1. 브릿지폰에 카카오톡 로그인
2. 키오스크 알림톡 수신 확인
3. MacroDroid 설치
4. 알림 접근 권한 허용
5. 새 매크로 생성
6. Trigger: Notification Received
7. Application: 카카오톡
8. Text contains 조건: `입장했습니다`, `외출했습니다`, `퇴장했습니다`, `재입장을 했습니다`
9. Action: HTTP Request
10. Method: POST
11. URL: Beyond OS 전송 URL
12. Headers: `Content-Type: application/json`, `x-kiosk-secret: ...`
13. Body: 알림 본문 변수를 `rawText`에 넣은 JSON
14. 배터리 최적화에서 MacroDroid와 카카오톡 제외

## 6. 운영 전 체크리스트

- 테스트 학생 1명으로 먼저 입실/외출/재입장/퇴실을 모두 확인합니다.
- Beyond OS 우측 하단 자동반영 알림이 뜨는지 확인합니다.
- 최근 출결 이력에 `키오스크 자동반영` 배지가 표시되는지 확인합니다.
- Supabase `attendance_import_events` 테이블에 원문 로그가 저장되는지 확인합니다.
- 동명이인은 이름 뒤에 A, ①, 반명 등 구분표시를 붙여 저장합니다.

## v41-04 Heartbeat 매크로 추가

문자 수신 매크로와 별도로 Heartbeat 매크로를 하나 더 만듭니다.

1. Trigger: 주기적 실행 / 정기 실행 / Every 30 minutes
2. Action: HTTP Request
3. Method: POST
4. URL: Beyond OS `/api/kiosk-attendance-bridge`
5. Header: `x-kiosk-secret = KIOSK_BRIDGE_SECRET`
6. Header 선택: `x-source-device-id = sms-bridge-phone-01`
7. Body Content-Type: `text/plain`
8. Body: `KIOSK_HEARTBEAT`

Heartbeat가 정상 수신되면 설정 → 키오스크 브릿지에서 “마지막 Heartbeat”와 “마지막 신호”가 갱신됩니다.
