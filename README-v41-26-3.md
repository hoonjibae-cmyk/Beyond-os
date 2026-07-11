# Beyond OS v41-26.3 — 좌석 카드 상단 배지 잘림 보정

## 기준선
- v41-26.2 `beyond-os-v41-26-2-daily-closeout-console-layout-fix.zip`

## 수정 내용
- 좌석배치도 카드 왼쪽 상단의 `확인`, `미입력`, 순찰 선택 배지가 카드 안쪽 `overflow: hidden`에 의해 잘려 보이던 문제를 수정했습니다.
- 데스크탑과 모바일 좌석배치도 모두에서 상단 배지가 온전히 보이도록 보정했습니다.
- 좌석 카드 내부의 학생명/학습상태 텍스트는 기존처럼 말줄임 처리되도록 유지했습니다.

## 추가 설정
- 신규 SQL 없음
- 신규 환경변수 없음
- MacroDroid 변경 없음

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
