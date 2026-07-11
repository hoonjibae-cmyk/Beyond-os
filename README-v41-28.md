# Beyond OS v41-28 — 학생 관리 이력 + GPT 상담 요약

기준선: v41-27 `beyond-os-v41-27-attention-history-menu.zip`

## 핵심 변경

1. 왼쪽 메뉴에 `학생 관리 이력` 독립 탭 추가
   - 좌석배치도 기본 클릭 동작은 변경하지 않았습니다.
   - 실시간 출결/순찰 입력은 계속 메인 대시보드에서 처리합니다.
   - `학생 관리 이력`은 과거 조회, 상담 준비, 누적 관리 확인용입니다.

2. 학생별 조회기간 통합 이력 화면
   - 학생 선택 + 조회기간 선택
   - 오늘 / 최근 7일 / 최근 30일 / 이번 주 / 이번 달 빠른 조회
   - 조회기간 요약 카드 제공

3. 엑셀식 압축 관리표
   - 날짜별 출결 요약
   - 순공시간
   - 순찰/학습상태 기록
   - 관리자 관찰/코멘트
   - 학습체크 상세
   - 플래너 검토
   - 관리주의/알림
   - 리포트 상태

4. 날짜별 상세 펼침
   - 출결 이벤트
   - 순찰/학습상태
   - 관리자 코멘트
   - 플래너 검토
   - 관리주의 이력
   - 알림/리포트 요약

5. GPT 상담 요약 초안 생성
   - 조회기간 데이터를 기반으로 내부 상담용 요약 초안 생성
   - 운영자가 수정 후 저장 가능
   - 자동 발송 기능은 없음
   - 저장된 요약은 같은 학생/기간 조회 시 다시 불러옴

## Supabase 필수 SQL

이번 버전은 GPT 상담 요약 저장을 위해 신규 SQL 실행이 필요합니다.

```sql
beyond-os-supabase-student-counseling-summaries-v41-28.sql
```

## Vercel 환경변수

GPT 상담 요약 생성을 사용하려면 아래 환경변수가 필요합니다.

```bash
OPENAI_API_KEY=실제_OpenAI_API_Key
```

선택적으로 상담 요약 전용 모델을 지정할 수 있습니다.

```bash
GPT_SUMMARY_MODEL=gpt-4o-mini
```

설정하지 않으면 `GPT_SUMMARY_MODEL → STUDENT_SUMMARY_MODEL → OPENAI_MODEL → gpt-4o-mini` 순서로 모델을 사용합니다.

## 추가 설정

- MacroDroid 변경 없음
- 기존 알림톡 환경변수 변경 없음

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```

## 검증

`npm run build` 정상 통과.
