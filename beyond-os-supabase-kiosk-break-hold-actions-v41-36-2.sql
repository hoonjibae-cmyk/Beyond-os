-- Beyond OS v41-36.2
-- 쉬는 시간 HOLD 처리 이력 / 되돌리기 감사 로그

create table if not exists kiosk_attendance_hold_actions (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references kiosk_attendance_holds(id) on delete cascade,
  batch_id text,
  action_type text not null,
  previous_status text,
  next_status text,
  actor_name text,
  action_memo text,
  attendance_event_id uuid references attendance_events(id) on delete set null,
  action_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table kiosk_attendance_hold_actions add column if not exists hold_id uuid references kiosk_attendance_holds(id) on delete cascade;
alter table kiosk_attendance_hold_actions add column if not exists batch_id text;
alter table kiosk_attendance_hold_actions add column if not exists action_type text;
alter table kiosk_attendance_hold_actions add column if not exists previous_status text;
alter table kiosk_attendance_hold_actions add column if not exists next_status text;
alter table kiosk_attendance_hold_actions add column if not exists actor_name text;
alter table kiosk_attendance_hold_actions add column if not exists action_memo text;
alter table kiosk_attendance_hold_actions add column if not exists attendance_event_id uuid references attendance_events(id) on delete set null;
alter table kiosk_attendance_hold_actions add column if not exists action_payload jsonb not null default '{}'::jsonb;
alter table kiosk_attendance_hold_actions add column if not exists created_at timestamptz not null default now();

create index if not exists idx_kiosk_hold_actions_hold_created
  on kiosk_attendance_hold_actions(hold_id, created_at desc);

create index if not exists idx_kiosk_hold_actions_batch
  on kiosk_attendance_hold_actions(batch_id, created_at desc);

create index if not exists idx_kiosk_hold_actions_created
  on kiosk_attendance_hold_actions(created_at desc);

comment on table kiosk_attendance_hold_actions is '쉬는 시간 HOLD의 실제 출결 반영, 쉬는 시간 처리, 되돌리기 이력';

create index if not exists idx_kiosk_holds_duplicate_guard
  on kiosk_attendance_holds(student_id, event_type, event_at desc);
