-- Beyond OS v41-31: 멘토링 시간표 반복·복수배정·1~8차시 보정
-- 실행 위치: Supabase SQL Editor
-- 목적: 월/수/금 1~8차시 학습멘토링, 반복 배정, 학생 복수 배정을 관리합니다.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists mentoring_mentors (
  id uuid primary key default gen_random_uuid(),
  mentor_code text not null,
  mentor_name text not null,
  capacity_target integer not null default 13,
  sort_order integer not null default 99,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table mentoring_mentors add column if not exists mentor_code text;
alter table mentoring_mentors add column if not exists mentor_name text;
alter table mentoring_mentors add column if not exists capacity_target integer not null default 13;
alter table mentoring_mentors add column if not exists sort_order integer not null default 99;
alter table mentoring_mentors add column if not exists is_active boolean not null default true;
alter table mentoring_mentors add column if not exists created_at timestamptz default now();
alter table mentoring_mentors add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_mentoring_mentors_code on mentoring_mentors(mentor_code);
create index if not exists idx_mentoring_mentors_active_sort on mentoring_mentors(is_active, sort_order);

drop trigger if exists set_timestamp_mentoring_mentors on mentoring_mentors;
create trigger set_timestamp_mentoring_mentors
before update on mentoring_mentors
for each row execute function public.set_updated_at();

create table if not exists mentoring_slots (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null,
  slot_label text not null,
  start_time text not null,
  end_time text not null,
  min_capacity integer not null default 3,
  max_capacity integer not null default 4,
  sort_order integer not null default 99,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint mentoring_slots_day_check check (day_of_week in (1, 3, 5))
);

alter table mentoring_slots add column if not exists day_of_week integer;
alter table mentoring_slots add column if not exists slot_label text;
alter table mentoring_slots add column if not exists start_time text;
alter table mentoring_slots add column if not exists end_time text;
alter table mentoring_slots add column if not exists min_capacity integer not null default 3;
alter table mentoring_slots add column if not exists max_capacity integer not null default 4;
alter table mentoring_slots add column if not exists sort_order integer not null default 99;
alter table mentoring_slots add column if not exists is_active boolean not null default true;
alter table mentoring_slots add column if not exists created_at timestamptz default now();
alter table mentoring_slots add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_mentoring_slots_unique on mentoring_slots(day_of_week, slot_label, start_time);
create index if not exists idx_mentoring_slots_day_sort on mentoring_slots(day_of_week, sort_order, start_time);

drop trigger if exists set_timestamp_mentoring_slots on mentoring_slots;
create trigger set_timestamp_mentoring_slots
before update on mentoring_slots
for each row execute function public.set_updated_at();

create table if not exists mentoring_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  mentor_id uuid references mentoring_mentors(id) on delete set null,
  slot_id uuid references mentoring_slots(id) on delete cascade,
  note text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table mentoring_assignments add column if not exists student_id uuid references students(id) on delete cascade;
alter table mentoring_assignments add column if not exists mentor_id uuid references mentoring_mentors(id) on delete set null;
alter table mentoring_assignments add column if not exists slot_id uuid references mentoring_slots(id) on delete cascade;
alter table mentoring_assignments add column if not exists note text;
alter table mentoring_assignments add column if not exists is_active boolean not null default true;
alter table mentoring_assignments add column if not exists created_at timestamptz default now();
alter table mentoring_assignments add column if not exists updated_at timestamptz default now();

alter table mentoring_assignments add column if not exists repeat_rule text default 'weekly';
alter table mentoring_assignments add column if not exists valid_from date default current_date;
alter table mentoring_assignments add column if not exists valid_to date;

create index if not exists idx_mentoring_assignments_student on mentoring_assignments(student_id, is_active);
create index if not exists idx_mentoring_assignments_slot on mentoring_assignments(slot_id, is_active);
create index if not exists idx_mentoring_assignments_mentor on mentoring_assignments(mentor_id, is_active);
create index if not exists idx_mentoring_assignments_validity on mentoring_assignments(valid_from, valid_to, is_active);

drop trigger if exists set_timestamp_mentoring_assignments on mentoring_assignments;
create trigger set_timestamp_mentoring_assignments
before update on mentoring_assignments
for each row execute function public.set_updated_at();

insert into mentoring_mentors (mentor_code, mentor_name, capacity_target, sort_order, is_active)
values
  ('mentor_a', '학습멘토 A', 13, 1, true),
  ('mentor_b', '학습멘토 B', 13, 2, true)
on conflict (mentor_code)
do update set
  mentor_name = excluded.mentor_name,
  capacity_target = excluded.capacity_target,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

with default_slots(day_of_week, slot_label, start_time, end_time, min_capacity, max_capacity, sort_order) as (
  values
    (1, '1차시', '09:00', '09:50', 3, 4, 10900),
    (1, '2차시', '10:00', '10:50', 3, 4, 11000),
    (1, '3차시', '11:00', '11:50', 3, 4, 11100),
    (1, '4차시', '13:00', '13:50', 3, 4, 11300),
    (1, '5차시', '14:00', '14:50', 3, 4, 11400),
    (1, '6차시', '15:00', '15:50', 3, 4, 11500),
    (1, '7차시', '16:00', '16:50', 3, 4, 11600),
    (1, '8차시', '17:00', '17:50', 3, 4, 11700),
    (3, '1차시', '09:00', '09:50', 3, 4, 30900),
    (3, '2차시', '10:00', '10:50', 3, 4, 31000),
    (3, '3차시', '11:00', '11:50', 3, 4, 31100),
    (3, '4차시', '13:00', '13:50', 3, 4, 31300),
    (3, '5차시', '14:00', '14:50', 3, 4, 31400),
    (3, '6차시', '15:00', '15:50', 3, 4, 31500),
    (3, '7차시', '16:00', '16:50', 3, 4, 31600),
    (3, '8차시', '17:00', '17:50', 3, 4, 31700),
    (5, '1차시', '09:00', '09:50', 3, 4, 50900),
    (5, '2차시', '10:00', '10:50', 3, 4, 51000),
    (5, '3차시', '11:00', '11:50', 3, 4, 51100),
    (5, '4차시', '13:00', '13:50', 3, 4, 51300),
    (5, '5차시', '14:00', '14:50', 3, 4, 51400),
    (5, '6차시', '15:00', '15:50', 3, 4, 51500),
    (5, '7차시', '16:00', '16:50', 3, 4, 51600),
    (5, '8차시', '17:00', '17:50', 3, 4, 51700)
)
insert into mentoring_slots (day_of_week, slot_label, start_time, end_time, min_capacity, max_capacity, sort_order, is_active)
select day_of_week, slot_label, start_time, end_time, min_capacity, max_capacity, sort_order, true
from default_slots
on conflict (day_of_week, slot_label, start_time)
do update set
  end_time = excluded.end_time,
  min_capacity = excluded.min_capacity,
  max_capacity = excluded.max_capacity,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();
