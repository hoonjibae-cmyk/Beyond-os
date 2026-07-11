# Beyond OS v40-123

## 기준
- 기준 파일: beyond-os-v40-122-kiosk-bridge-operations-log.zip
- 신규 버전: v40-123
- v41/v42 실험 브랜치: 미포함
- 신규 SQL: 없음
- 단, v40-115 키오스크 Bridge SQL 필요

## 핵심 변경
- 키오스크 자동반영 실패를 우측 하단 알림으로 표시
- 좌석 상세 패널에 해당 학생의 최근 키오스크 실패 알림 표시
- 설정 > 키오스크 브릿지에 오늘 운영 요약 추가
- 실패 로그는 진단용으로 유지하고, 수동 보정은 기존 좌석배치도 출결 상태 변경 기능 사용
- 상단 버전 표시 및 /api/health 버전 v40-123 갱신

## 배포
```powershell
cd C:\BeyondOS-current
npx.cmd vercel --prod --yes
```
