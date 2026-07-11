-- Beyond OS v41-05: 키오스크 수신 로그 재처리 / 학생명 별칭 연결
-- 목적:
-- 1) 키오스크 문자 학생명과 Beyond OS 학생명이 다른 경우, 1회 수동 연결 후 자동 매칭
-- 2) 실패/보류 로그를 관리자 화면에서 재처리 또는 무시 처리
-- 3) 기존 attendance_import_events에 관리자 처리 메타데이터를 기록

create table if not exists kiosk_student_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_name text not null,
  student_id uuid not null references students(id) on delete cascade,
  source text not null default 'kiosk_alimtalk',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table kiosk_student_aliases add column if not exists alias_name text;
alter table kiosk_student_aliases add column if not exists student_id uuid references students(id) on delete cascade;
alter table kiosk_student_aliases add column if not exists source text not null default 'kiosk_alimtalk';
alter table kiosk_student_aliases add column if not exists is_active boolean not null default true;
alter table kiosk_student_aliases add column if not exists created_at timestamptz not null default now();
alter table kiosk_student_aliases add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_kiosk_student_aliases_alias_source
on kiosk_student_aliases(alias_name, source)
where is_active = true;

create index if not exists idx_kiosk_student_aliases_student_id
on kiosk_student_aliases(student_id);

create index if not exists idx_kiosk_student_aliases_active
on kiosk_student_aliases(is_active);

alter table attendance_import_events add column if not exists operator_action text;
alter table attendance_import_events add column if not exists operator_memo text;
alter table attendance_import_events add column if not exists resolved_at timestamptz;
alter table attendance_import_events add column if not exists linked_import_event_id uuid references attendance_import_events(id) on delete set null;

create index if not exists idx_attendance_import_events_operator_action
on attendance_import_events(operator_action);

create index if not exists idx_attendance_import_events_resolved_at
on attendance_import_events(resolved_at desc);

-- v41-05 기본 설정값 보강: 수동 출결 직후 키오스크 중복 무시 시간
insert into system_settings (setting_key, setting_value, updated_at)
values (
  'kiosk_bridge_settings',
  '{
    "autoApplyEnabled": true,
    "staleWarningMinutes": 60,
    "heartbeatIntervalMinutes": 30,
    "manualConflictWindowSeconds": 60,
    "operatingHoursEnabled": true,
    "operationStartTime": "09:00",
    "operationEndTime": "24:00"
  }'::jsonb,
  now()
)
on conflict (setting_key)
do update set
  setting_value = system_settings.setting_value || '{"manualConflictWindowSeconds": 60}'::jsonb,
  updated_at = now()
where not (system_settings.setting_value ? 'manualConflictWindowSeconds');
