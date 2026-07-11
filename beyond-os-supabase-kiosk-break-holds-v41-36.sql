-- Beyond OS v41-36
-- 쉬는 시간 키오스크 외출/복귀/퇴실/재입실 신호 HOLD 큐

create table if not exists kiosk_attendance_holds (
  id uuid primary key default gen_random_uuid(),
  import_event_id uuid references attendance_import_events(id) on delete set null,
  student_id uuid not null references students(id) on delete cascade,
  session_id uuid references daily_sessions(id) on delete set null,
  attendance_event_id uuid references attendance_events(id) on delete set null,
  seat_no integer,
  event_type text not null,
  event_at timestamptz not null,
  raw_text text,
  parsed_reason text,
  hold_reason text not null default 'break_window',
  break_label text,
  break_start_time text,
  break_end_time text,
  status text not null default 'pending',
  operator_action text,
  operator_memo text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table kiosk_attendance_holds add column if not exists import_event_id uuid references attendance_import_events(id) on delete set null;
alter table kiosk_attendance_holds add column if not exists student_id uuid references students(id) on delete cascade;
alter table kiosk_attendance_holds add column if not exists session_id uuid references daily_sessions(id) on delete set null;
alter table kiosk_attendance_holds add column if not exists attendance_event_id uuid references attendance_events(id) on delete set null;
alter table kiosk_attendance_holds add column if not exists seat_no integer;
alter table kiosk_attendance_holds add column if not exists event_type text;
alter table kiosk_attendance_holds add column if not exists event_at timestamptz;
alter table kiosk_attendance_holds add column if not exists raw_text text;
alter table kiosk_attendance_holds add column if not exists parsed_reason text;
alter table kiosk_attendance_holds add column if not exists hold_reason text default 'break_window';
alter table kiosk_attendance_holds add column if not exists break_label text;
alter table kiosk_attendance_holds add column if not exists break_start_time text;
alter table kiosk_attendance_holds add column if not exists break_end_time text;
alter table kiosk_attendance_holds add column if not exists status text default 'pending';
alter table kiosk_attendance_holds add column if not exists operator_action text;
alter table kiosk_attendance_holds add column if not exists operator_memo text;
alter table kiosk_attendance_holds add column if not exists resolved_by text;
alter table kiosk_attendance_holds add column if not exists resolved_at timestamptz;
alter table kiosk_attendance_holds add column if not exists created_at timestamptz default now();
alter table kiosk_attendance_holds add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_kiosk_attendance_holds_import_event
on kiosk_attendance_holds(import_event_id)
where import_event_id is not null;

create index if not exists idx_kiosk_attendance_holds_status_event_at
on kiosk_attendance_holds(status, event_at desc);

create index if not exists idx_kiosk_attendance_holds_student_event_at
on kiosk_attendance_holds(student_id, event_at desc);

comment on table kiosk_attendance_holds is '쉬는 시간에 수신된 키오스크 출결 신호를 실제 출결 반영 전 임시 보관하는 HOLD 큐';
