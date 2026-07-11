# Beyond OS v40-122 Kiosk Bridge Operations Log

- 기준 파일: beyond-os-v40-121-sms-web-sender-phrase-expansion.zip
- v41/v42 실험 브랜치: 미포함
- 신규 SQL: 없음
- 단, v40-115 키오스크 Bridge SQL 필요

## 변경 요약

1. 설정 → 키오스크 브릿지 화면에 최근 키오스크 수신 로그 카드 추가
2. 최근 50건의 attendance_import_events 조회
3. 성공/실패/중복/수신·보류 필터 추가
4. raw_text 원문 펼쳐보기 및 복사 기능 추가
5. 파싱된 학생명, 이벤트 유형, sourceDeviceId, 실패 사유, idempotencyKey 표시
6. 상단 버전 표시 v40-122로 갱신

## 테스트

1. 설정 → 키오스크 브릿지 진입
2. 최근 키오스크 수신 로그 카드 확인
3. MacroDroid에서 실제 문자 1건 전송
4. 로그 새로고침
5. raw_text와 처리 상태가 표시되는지 확인
