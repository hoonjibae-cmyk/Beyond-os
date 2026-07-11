# Beyond OS v41-05 Deploy Fix

이 패키지는 v41-05 기능 내용은 그대로 유지하면서 Vercel 배포 중 `npm install` 단계에서 실패할 수 있는 `package-lock.json`을 제거한 배포용 hotfix입니다.

## 변경 사항

- `package-lock.json` 제거
- v41-05 기능/SQL/API/UI 변경 없음

## 적용 방법

1. 이 zip을 Vercel에 다시 업로드/배포합니다.
2. Supabase에는 기존과 동일하게 `beyond-os-supabase-kiosk-bridge-v41-05.sql`만 실행하면 됩니다.
3. Vercel 환경변수와 MacroDroid 설정은 기존 v41-04/v41-05와 동일합니다.
