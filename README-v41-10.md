# Beyond OS v41-10 — 출결 알림 발송 안정화 콘솔

기준선: v41-09.1 Hobby Cron deploy-fix

## 핵심 변경

1. `설정 → 출결 알림 로그`를 `출결 알림톡 안정화 콘솔`로 확장
   - 출결 알림 로그
   - 학생별 수신 점검

2. 학생별 알림 수신 가능 여부 점검
   - 보호자 연락처 유무
   - 전화번호 형식
   - 최근 발송 상태
   - 테스트모드/테스트 수신번호 상태
   - 출결 템플릿/API 설정 확인

3. 실패/건너뜀 사유 진단 강화
   - 보호자 연락처 없음
   - 테스트 수신번호 없음
   - 템플릿/API 설정 확인
   - Allowlist 차단
   - 학생별 제외 설정
   - Webhook/API 연결 확인

4. 출결 알림 재발송
   - 출결 알림 로그에서 `재발송` 버튼 추가
   - 재발송 시 현재 보호자 연락처와 현재 테스트모드 설정을 다시 적용
   - 기존 idempotencyKey와 충돌하지 않도록 재발송용 키 생성

5. 학생별 출결 알림 제외 설정
   - 입실 제외
   - 퇴실 제외
   - 외출 제외
   - 복귀 제외
   - 복귀 지연 제외
   - 제외된 이벤트는 발송하지 않고 `건너뜀` 로그를 남김

6. 테스트모드 상태 표시 강화
   - 리포트 발송 설정 상단
   - 출결 알림 안정화 콘솔 상단

## Supabase 필수 SQL

이번 버전은 학생별 알림 제외 설정 테이블이 필요합니다.

```sql
beyond-os-supabase-attendance-notification-preferences-v41-10.sql
```

기존 v41-07의 아래 SQL도 이미 실행되어 있어야 합니다.

```sql
beyond-os-supabase-attendance-notifications-v41-07.sql
```

## Vercel / MacroDroid

추가 환경변수 없음.
기존 설정 유지:

- `KIOSK_BRIDGE_SECRET`
- `SOLAPI_TEMPLATE_ID_ATTENDANCE`
- 기존 MacroDroid 문자/Heartbeat/복귀지연 점검 매크로

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
