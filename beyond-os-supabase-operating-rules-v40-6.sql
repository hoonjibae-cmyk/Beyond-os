-- Beyond OS v40-6: 운영 기준 설정 저장 테이블
-- 출결현황의 지각, 조퇴, 외출과다, 순공부족, 관리주의 판정 기준을 저장합니다.

create table if not exists system_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

insert into system_settings (setting_key, setting_value, updated_at)
values (
  'operating_rules',
  '{
    "lowStudyMinutes": 300,
    "lateThresholdMinutes": 1,
    "earlyLeaveThresholdMinutes": 10,
    "excessiveAwayCount": 2,
    "excessiveAwayMinutes": 60,
    "attentionKeywords": ["수면", "비학습", "주의", "집중", "졸", "태도", "휴대폰", "잡담"]
  }'::jsonb,
  now()
)
on conflict (setting_key) do nothing;
