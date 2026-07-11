# Beyond OS v41-20 — 알림톡 템플릿·발송 설정 통합 점검 콘솔

기준 버전: v41-19 `beyond-os-v41-19-multidevice-field-focus-sync.zip`

## 핵심 변경

1. `설정 → 알림톡 템플릿 관리` 탭 추가
   - 데일리 리포트
   - 위클리 리포트
   - 출결 자동 알림
   - 학부모 확인 요청
   네 가지 알림톡 템플릿 상태를 한 화면에서 확인합니다.

2. 템플릿별 상태 통합 표시
   - 설정됨 / 미설정
   - 현재 감지된 환경변수명
   - SOLAPI 권장 환경변수
   - Direct Kakao 템플릿 코드명
   - 발송 모드

3. 템플릿별 필수 변수 안내
   - 데일리: `#{학생명}`, `#{날짜}`, `#{출결상태}`, `#{순공시간}`, `#{확인사항}`, `#{리포트링크}`
   - 위클리: `#{학생명}`, `#{기간}`, `#{주간순공시간}`, `#{확인사항}`, `#{리포트링크}`
   - 출결: `#{학생명}`, `#{날짜}`, `#{출결구분}`, `#{출결시간}`, `#{기록방식}`
   - 학부모 확인 요청: `#{학생명}`, `#{예정학습시간}`, `#{예정외출시간}`, `#{현재상태}`

4. 통합 테스트 payload 생성
   - 기존 데일리/위클리뿐 아니라 출결 자동 알림, 학부모 확인 요청도 테스트 payload를 생성할 수 있습니다.
   - 실제 알림톡은 발송하지 않습니다.

5. 통합 템플릿 변수 검증
   - 네 가지 템플릿 유형 모두 필수 변수 누락 여부를 화면에서 즉시 검증합니다.

6. 현재 위험 요소 표시
   - Fail-safe ON
   - 테스트모드 ON인데 테스트번호 미설정
   - 전체 실전 발송 가능 상태
   - 템플릿 미설정
   - 리포트 링크 DB 확인 필요
   - SOLAPI API Key / Secret / Channel 미설정
   등을 한 곳에서 보여줍니다.

## 추가 설정

신규 SQL 없음.
신규 환경변수 없음.
MacroDroid 변경 없음.

기존 권장 환경변수는 다음과 같습니다.

```text
KAKAO_PROVIDER_MODE=solapi
KAKAO_FAIL_SAFE_MODE=true
KAKAO_RECIPIENT_TEST_MODE=true
KAKAO_TEST_RECIPIENT_PHONE=원장님_테스트번호
SOLAPI_API_KEY=발급받은_API_KEY
SOLAPI_API_SECRET=발급받은_API_SECRET
SOLAPI_CHANNEL_ID=channelId_또는_pfId
SOLAPI_TEMPLATE_ID_DAILY=데일리_templateId
SOLAPI_TEMPLATE_ID_WEEKLY=위클리_templateId
SOLAPI_TEMPLATE_ID_ATTENDANCE=출결_templateId
SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION=학부모확인요청_templateId
```

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
