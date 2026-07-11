# Beyond OS v41-19 · 멀티디바이스 관리필요 동기화 패치

기준선: v41-18 `beyond-os-v41-18-parent-confirmation-modal-ux.zip`

## 핵심 수정

- 기존 관리필요 확인/해제 상태가 브라우저 localStorage 중심으로 저장되어 데스크탑과 모바일 간 상태가 다르게 보일 수 있던 문제 수정
- `field_focus_acknowledgements` Supabase 테이블 추가
- 데스크탑에서 관리필요 확인/해제 메모를 저장하면 모바일에서도 동일하게 해제 상태 반영
- 모바일에서 처리한 해제 이력도 데스크탑에 반영
- 대시보드 자동 동기화 서명에 관리필요 해제 이력을 포함해 다른 기기 변경 반영 정확도 개선
- Supabase 테이블이 아직 없을 경우, 화면에는 임시 반영되지만 안내 메시지로 SQL 적용 필요를 표시

## 필수 SQL

Supabase SQL Editor에서 아래 파일을 실행해야 합니다.

```text
beyond-os-supabase-field-focus-acknowledgements-v41-19.sql
```

## 추가 환경변수 / MacroDroid

없음.

## 배포 명령

```powershell
npx.cmd vercel --prod --yes
```
