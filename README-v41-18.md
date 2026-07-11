# Beyond OS v41-18 — Parent Confirmation Modal UX Stabilization

## 기준선
- v41-17 Parent Confirmation Alert Send Flow

## 핵심 변경
1. 시간표 알림센터 `학부모 확인 요청 알림톡` 모달 우측 상단의 빈 사각형처럼 보이던 버튼을 명확한 `× 닫기` 버튼으로 수정했습니다.
2. 테스트모드 ON/OFF, 수신자 수, 템플릿 설정 상태, 발송 방식 표시를 더 명확하게 정리했습니다.
3. 템플릿 환경변수명이 길게 잘려 보이던 영역을 `학부모 확인 요청 템플릿: 설정됨/미설정` 중심으로 보여주고, 실제 환경변수명은 보조 텍스트로 표시하도록 개선했습니다.
4. 발송 후 모달이 바로 닫히지 않고, 발송 성공/실패/초안 저장 결과를 모달 안에서 확인할 수 있도록 변경했습니다.
5. 문구를 수정하면 이전 발송 결과/오류 표시가 초기화되어 현재 문구 기준으로 다시 발송 판단을 할 수 있습니다.

## 추가 설정
- 신규 SQL 없음
- 신규 환경변수 없음
- MacroDroid 변경 없음

## 기존 필요 환경변수
- `SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION`

## 배포 명령
```powershell
npx.cmd vercel --prod --yes
```
