# Beyond OS v40-120

## 기준
- 기준 파일: beyond-os-v40-119-kiosk-bridge-import-log-save-hotfix.zip
- v41/v42 실험 브랜치: 미포함
- 신규 SQL: 없음
- 단, v40-115 키오스크 Bridge SQL은 필요

## 핵심 변경
- `/api/kiosk-attendance-bridge`가 `application/json`뿐 아니라 `text/plain` Body도 수신합니다.
- MacroDroid에서 SMS 본문 매직텍스트를 JSON 안에 넣을 때 줄바꿈 때문에 Body가 깨지는 문제를 피할 수 있습니다.
- `[Web발신]` 줄바꿈 문자 형식을 지원합니다.
- `입장했어요`, `잠시 외출했어요`, `재입장했어요`, `퇴장했어요` 문구를 각각 입실/외출/복귀/퇴실로 파싱합니다.
- 설정 → 키오스크 브릿지 가이드를 SMS/Web발신 문자 중심으로 보정했습니다.

## MacroDroid 권장 설정
- Method: POST
- URL: `https://운영주소/api/kiosk-attendance-bridge`
- Headers:
  - `x-kiosk-secret: KIOSK_BRIDGE_SECRET 값`
  - 선택: `x-source-device-id: sms-bridge-phone-01`
- Body Content-Type: `text/plain`
- Body: SMS 본문 매직텍스트만 그대로 입력

## 지원 문자 예시

```text
[Web발신]
더플레이스26
테스트 학생이 잠시 외출했어요.
 사유: 외출
```
