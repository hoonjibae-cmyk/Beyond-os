# Beyond OS v41-17

## Parent Confirmation Alert Send Flow

기준선: `v41-16.1 Presence Attention Default Schedule Fix`

### 핵심 변경

1. 시간표 알림센터의 `학부모 알림` 버튼을 실제 발송 흐름으로 개선했습니다.
   - 기존: 문구 생성 후 `parent_notification_logs`에 draft 저장
   - 변경: 알림톡 미리보기 모달 → 문구/변수 확인 → 실제 발송 또는 초안 저장

2. 학부모 확인 요청 알림톡 별도 템플릿을 추가했습니다.
   - SOLAPI 환경변수: `SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION`
   - Direct Kakao 환경변수: `KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION`

3. 템플릿 변수는 아래 4개입니다.
   - `#{학생명}`
   - `#{예정학습시간}`
   - `#{예정외출시간}`
   - `#{현재상태}`

4. 권장 템플릿 문구

```text
[The Place 26 학부모 확인 요청]

#{학생명} 학생의 비욘드 썸머스쿨 출결 확인이 필요한 상황이 발생했습니다.

- 금일 예정 학습 시간: #{예정학습시간}
- 금일 예정 외출 시간: #{예정외출시간}
- 현재 상태: #{현재상태}

담당자가 학생 확인을 진행한 뒤, 필요 시 학부모님께 추가 연락드리겠습니다.

목동유쌤영어학원
```

5. 테스트모드와 연동합니다.
   - 테스트모드 ON: 테스트 수신번호로 대체 발송
   - 테스트모드 OFF: 실제 보호자 연락처 기준 발송

6. 설정 화면에 `학부모 확인 요청` 템플릿 상태 카드를 추가했습니다.

### 추가 설정

Vercel 환경변수에 아래 값을 추가해야 실제 SOLAPI 발송이 가능합니다.

```text
SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION=SOLAPI에서 복사한 실제 템플릿 ID
```

Direct Kakao Adapter 사용 시에는 아래 값을 사용합니다.

```text
KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION=승인된 템플릿 코드
```

### 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
