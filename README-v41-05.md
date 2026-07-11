# Beyond OS v41-05 — Kiosk Import Recovery Console

v41-05는 v41-04(`beyond-os-v41-04-kiosk-bridge-heartbeat-monitor(1).zip`)을 기준으로 한 후속 업데이트입니다.

## 핵심 업데이트

1. 키오스크 수신 로그 관리자 처리
   - 실패/보류 로그 상세 화면에서 `학생 연결 후 재처리`, `그대로 재처리`, `이 로그 무시` 버튼 추가
   - 재처리 성공 시 기존 실패 로그는 `재처리 완료`로 정리되고, 새 처리 로그와 연결됩니다.

2. 학생명 수동 연결 규칙
   - 키오스크 문자명과 Beyond OS 등록명이 다른 경우 1회 연결 가능
   - 예: 문자명 `김민준` → Beyond OS 학생 `김민준A`
   - 이후 같은 문자명은 자동 매칭됩니다.

3. 중복 방지 시간 설정화
   - 설정 → 키오스크 브릿지 → Heartbeat / 운영시간 감시 설정
   - `수동입력-키오스크 중복 방지(초)` 값을 화면에서 조정 가능
   - 기본값은 60초입니다.

4. 운영 로그 화면 보강
   - 최근 50건 요약에 `재처리`, `무시` 집계 추가
   - 필터에 `관리자 처리` 추가
   - 각 로그 상세에 관리자 메모, 연결된 재처리 로그 ID 표시

## Supabase 추가 SQL

v41-05 기능을 사용하려면 Supabase SQL Editor에서 아래 파일을 추가 실행하세요.

```text
beyond-os-supabase-kiosk-bridge-v41-05.sql
```

이 SQL은 다음을 추가합니다.

- `kiosk_student_aliases` 테이블
- `attendance_import_events.operator_action`
- `attendance_import_events.operator_memo`
- `attendance_import_events.resolved_at`
- `attendance_import_events.linked_import_event_id`
- `kiosk_bridge_settings.manualConflictWindowSeconds` 기본값

## Vercel / MacroDroid

v41-04와 동일합니다. 추가 환경변수는 없습니다.

- Vercel: `KIOSK_BRIDGE_SECRET` 유지
- MacroDroid 문자 전송 URL: `/api/kiosk-attendance-bridge`
- Heartbeat Body: `KIOSK_HEARTBEAT`

## 주의

`학생 연결 후 재처리`와 `그대로 재처리`는 실제 출결에 반영됩니다. 운영 중에는 실패 로그의 원문과 학생 선택을 확인한 뒤 실행하세요.
