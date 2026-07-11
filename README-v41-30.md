# Beyond OS v41-30 Mentoring Schedule and Seat Cue

기준선: v41-29 `beyond-os-v41-29-student-history-polish-gpt-counseling-modes.zip`

## 핵심 변경

1. 왼쪽 메뉴에 `멘토링 시간표` 독립 탭 추가
2. 월·수·금 학습멘토링 차시 관리 기능 추가
3. 2명의 학습멘토 기본 세팅: `학습멘토 A`, `학습멘토 B`
4. 각 멘토의 담당 목표 인원 13명 표시 및 수정 가능
5. 차시별 권장 배정 인원 3~4명 표시
6. 학생별 멘토링 배정 추가/삭제 가능
7. 차시 시간 수정 및 신규 차시 추가 가능
8. 매 차시 시작 10분 전부터 차시 종료까지 좌석배치도에서 해당 학생을 파란색 `멘토링`으로 표시
9. 관리주의 빨간색이 필요한 경우에는 빨간색이 우선 표시되고, 멘토링 배지는 보조로 표시됨

## Supabase 필수 SQL

아래 SQL을 Supabase SQL Editor에서 실행해야 합니다.

```text
beyond-os-supabase-mentoring-schedule-v41-30.sql
```

## Vercel / MacroDroid

추가 환경변수 없음.
MacroDroid 변경 없음.

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
