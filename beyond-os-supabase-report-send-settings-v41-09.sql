-- Beyond OS v41-09
-- 출결 알림 ON/OFF 및 복귀 지연 알림 기본 설정
-- 신규 테이블은 없습니다. system_settings.report_send_settings JSON에 기본값을 병합합니다.
-- 기존에 화면에서 저장한 값이 있으면 기존 값을 우선합니다.

insert into system_settings (setting_key, setting_value, updated_at)
values (
  'report_send_settings',
  '{
    "recipientTestMode": null,
    "attendanceNotifications": {
      "checkInEnabled": true,
      "checkOutEnabled": true,
      "awayEnabled": false,
      "returnEnabled": false,
      "returnOverdueEnabled": true,
      "returnOverdueGraceMinutes": 15
    }
  }'::jsonb,
  now()
)
on conflict (setting_key)
do update set
  setting_value = coalesce(system_settings.setting_value, '{}'::jsonb)
    || jsonb_build_object(
      'attendanceNotifications',
      '{
        "checkInEnabled": true,
        "checkOutEnabled": true,
        "awayEnabled": false,
        "returnEnabled": false,
        "returnOverdueEnabled": true,
        "returnOverdueGraceMinutes": 15
      }'::jsonb
      || coalesce(system_settings.setting_value->'attendanceNotifications', '{}'::jsonb)
    ),
  updated_at = now();
