# Beyond OS v41-09.1 Hobby Deploy Fix

## 수정 이유

Vercel Hobby 계정에서는 하루 1회보다 자주 실행되는 Cron schedule을 사용할 수 없습니다. 기존 v41-09의 아래 설정 때문에 배포가 차단되었습니다.

```text
*/10 * * * *
```

## 수정 내용

- `vercel.json`에서 `/api/attendance-return-overdue-check` 10분 Cron 제거
- 자정 자동퇴실 Cron `/api/auto-checkout`은 유지
- 복귀 지연 점검은 MacroDroid 외부 호출 방식으로 전환
- `/api/attendance-return-overdue-check`에 `x-kiosk-secret` 인증 체크 추가

## MacroDroid 추가 매크로

```text
Trigger:
10분마다 반복 실행

Action:
HTTP Request

Method:
POST

URL:
https://현재배포주소/api/attendance-return-overdue-check

Headers:
x-kiosk-secret: KIOSK_BRIDGE_SECRET 값

Body:
비워둠
```

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
