# Beyond OS v41-04

## 기준
- 기준 파일: `beyond-os-v41-03-kiosk-attendance-exception-guardrails.zip`
- 신규 버전: `v41-04`
- v40 계열: `v40-123`에서 종료
- v41/v42 실험 브랜치: 미포함
- 신규 SQL: 없음
- 단, v40-115 키오스크 Bridge SQL 필요

## 핵심 변경
- 키오스크 브릿지 Heartbeat 수신 지원
- MacroDroid에서 30분마다 `KIOSK_HEARTBEAT` text/plain 전송 가능
- 출결 문자와 Heartbeat를 모두 최근 신호로 인정
- 운영시간 기준 미수신 경고 적용
- 기본 미수신 경고 기준 60분 유지
- 운영시간 기본값 09:00~24:00
- 설정 → 키오스크 브릿지에 Heartbeat/운영시간 감시 설정 카드 추가
- 오늘 운영 요약에 Heartbeat 수신 건수와 마지막 신호 표시

## MacroDroid Heartbeat 권장 설정
- Trigger: 30분마다 반복
- Action: HTTP Request
- Method: POST
- URL: Beyond OS `/api/kiosk-attendance-bridge`
- Header: `x-kiosk-secret = KIOSK_BRIDGE_SECRET`
- Header 선택: `x-source-device-id = sms-bridge-phone-01`
- Body Content-Type: `text/plain`
- Body: `KIOSK_HEARTBEAT`

## 배포
```powershell
cd C:\BeyondOS-current
npx.cmd vercel --prod --yes
```
