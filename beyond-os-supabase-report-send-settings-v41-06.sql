-- Beyond OS v41-06: 리포트 발송 테스트모드 설정 기본값
-- system_settings 테이블이 이미 있는 환경에서 선택적으로 실행합니다.
-- recipientTestMode가 null이면 기존 Vercel 환경변수 KAKAO_RECIPIENT_TEST_MODE 값을 따릅니다.

insert into system_settings (setting_key, setting_value, updated_at)
values (
  'report_send_settings',
  '{"recipientTestMode": null}'::jsonb,
  now()
)
on conflict (setting_key) do nothing;
