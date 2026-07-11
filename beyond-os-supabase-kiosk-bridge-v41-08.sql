-- Beyond OS v41-08
-- 자정 이후 실제 키오스크 퇴실 보정 설정 기본값
-- 신규 테이블은 없습니다. system_settings.kiosk_bridge_settings에 보정 옵션 기본값만 추가합니다.
-- 실행 위치: Supabase SQL Editor

insert into system_settings (setting_key, setting_value, updated_at)
values (
  'kiosk_bridge_settings',
  '{
    "autoApplyEnabled": true,
    "staleWarningMinutes": 60,
    "heartbeatIntervalMinutes": 30,
    "manualConflictWindowSeconds": 60,
    "overnightCheckoutCorrectionEnabled": true,
    "overnightCheckoutGraceMinutes": 60,
    "operatingHoursEnabled": true,
    "operationStartTime": "09:00",
    "operationEndTime": "24:00"
  }'::jsonb,
  now()
)
on conflict (setting_key)
do update set
  setting_value = coalesce(system_settings.setting_value, '{}'::jsonb)
    || jsonb_build_object(
      'overnightCheckoutCorrectionEnabled', coalesce(system_settings.setting_value -> 'overnightCheckoutCorrectionEnabled', 'true'::jsonb),
      'overnightCheckoutGraceMinutes', coalesce(system_settings.setting_value -> 'overnightCheckoutGraceMinutes', '60'::jsonb)
    ),
  updated_at = now();
