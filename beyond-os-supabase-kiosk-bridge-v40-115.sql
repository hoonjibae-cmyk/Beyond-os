-- Beyond OS v40-115: 키오스크 알림톡 출결 자동반영 Bridge
-- 신규 SQL: 있음
-- 목적:
-- 1) 안드로이드 알림 브릿지에서 전달한 카카오 알림톡 원문을 수신/파싱/처리한 로그 보존
-- 2) attendance_events에 출결 기록 출처를 표시하여 키오스크 자동 기록과 관리자 수동 기록을 구분

create table if not exists attendance_import_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'kiosk_alimtalk',
  source_device_id text,
  idempotency_key text,
  raw_text text not null,
  parsed_event_type text,
  parsed_academy_name text,
  parsed_student_name text,
  parsed_reason text,
  parsed_duration text,
  student_id uuid references students(id) on delete set null,
  session_id uuid references daily_sessions(id) on delete set null,
  attendance_event_id uuid references attendance_events(id) on delete set null,
  seat_no integer,
  status text not null default 'received',
  error_message text,
  received_at timestamptz default now(),
  processed_at timestamptz,
  created_at timestamptz default now()
);

alter table attendance_import_events add column if not exists source text not null default 'kiosk_alimtalk';
alter table attendance_import_events add column if not exists source_device_id text;
alter table attendance_import_events add column if not exists idempotency_key text;
alter table attendance_import_events add column if not exists raw_text text;
alter table attendance_import_events add column if not exists parsed_event_type text;
alter table attendance_import_events add column if not exists parsed_academy_name text;
alter table attendance_import_events add column if not exists parsed_student_name text;
alter table attendance_import_events add column if not exists parsed_reason text;
alter table attendance_import_events add column if not exists parsed_duration text;
alter table attendance_import_events add column if not exists student_id uuid references students(id) on delete set null;
alter table attendance_import_events add column if not exists session_id uuid references daily_sessions(id) on delete set null;
alter table attendance_import_events add column if not exists attendance_event_id uuid references attendance_events(id) on delete set null;
alter table attendance_import_events add column if not exists seat_no integer;
alter table attendance_import_events add column if not exists status text not null default 'received';
alter table attendance_import_events add column if not exists error_message text;
alter table attendance_import_events add column if not exists received_at timestamptz default now();
alter table attendance_import_events add column if not exists processed_at timestamptz;
alter table attendance_import_events add column if not exists created_at timestamptz default now();

create unique index if not exists idx_attendance_import_events_idempotency
on attendance_import_events(idempotency_key)
where idempotency_key is not null;

create index if not exists idx_attendance_import_events_received_at
on attendance_import_events(received_at desc);

create index if not exists idx_attendance_import_events_status
on attendance_import_events(status);

alter table attendance_events add column if not exists source_type text not null default 'manual';
alter table attendance_events add column if not exists source_label text;
alter table attendance_events add column if not exists import_event_id uuid references attendance_import_events(id) on delete set null;

update attendance_events
set source_type = 'manual'
where source_type is null;

create index if not exists idx_attendance_events_source_type
on attendance_events(source_type);

create index if not exists idx_attendance_events_import_event_id
on attendance_events(import_event_id);
