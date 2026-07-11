-- Beyond OS v41-19: field focus acknowledgement central sync
-- 데스크탑/모바일 간 관리필요 확인·해제 상태를 중앙 DB에 저장하기 위한 테이블입니다.

create table if not exists field_focus_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  ack_date date not null,
  alert_id text not null,
  alert_type text,
  alert_title text,
  alert_body text,
  student_id uuid,
  student_name text,
  seat_no integer,
  planned_time text,
  current_status text,
  memo text,
  admin_name text,
  dismissed_at timestamptz default now(),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists field_focus_ack_unique
  on field_focus_acknowledgements (ack_date, alert_id);

create index if not exists field_focus_ack_date_idx
  on field_focus_acknowledgements (ack_date desc, dismissed_at desc);

create index if not exists field_focus_ack_student_idx
  on field_focus_acknowledgements (student_id, ack_date desc);

alter table field_focus_acknowledgements
  add column if not exists is_active boolean default true;

alter table field_focus_acknowledgements
  add column if not exists updated_at timestamptz default now();
