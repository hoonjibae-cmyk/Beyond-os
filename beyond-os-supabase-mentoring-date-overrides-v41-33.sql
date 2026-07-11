-- Beyond OS v41-33: 날짜별 멘토링 운영 일정 / 당일 수정 기능
-- 실행 위치: Supabase SQL Editor
-- 목적:
-- 1) 요일별 멘토링 템플릿을 특정 날짜의 운영 일정으로 자동 반영합니다.
-- 2) 특정 날짜만 차시/배정을 수정할 수 있도록 날짜별 차시와 날짜별 배정을 별도 저장합니다.
-- 3) 학생 개인 일정이 나중에 변경되어도 날짜별/요일별 멘토링 카드에 개인일정 주의 표시를 띄울 수 있게 합니다.
-- 주의: v41-31, v41-31.3, v41-31.4 SQL 실행 이후 적용하는 추가 패치입니다.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists mentoring_date_slots (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  template_slot_id uuid references mentoring_slots(id) on delete set null,
  day_of_week integer not null,
  slot_label text not null,
  start_time text not null,
  end_time text not null,
  min_capacity integer not null default 3,
  max_capacity integer not null default 4,
  sort_order integer not null default 99,
  note text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint mentoring_date_slots_day_check check (day_of_week in (1, 2, 3, 4, 5))
);

alter table mentoring_date_slots add column if not exists schedule_date date;
alter table mentoring_date_slots add column if not exists template_slot_id uuid references mentoring_slots(id) on delete set null;
alter table mentoring_date_slots add column if not exists day_of_week integer;
alter table mentoring_date_slots add column if not exists slot_label text;
alter table mentoring_date_slots add column if not exists start_time text;
alter table mentoring_date_slots add column if not exists end_time text;
alter table mentoring_date_slots add column if not exists min_capacity integer not null default 3;
alter table mentoring_date_slots add column if not exists max_capacity integer not null default 4;
alter table mentoring_date_slots add column if not exists sort_order integer not null default 99;
alter table mentoring_date_slots add column if not exists note text;
alter table mentoring_date_slots add column if not exists is_active boolean not null default true;
alter table mentoring_date_slots add column if not exists created_at timestamptz default now();
alter table mentoring_date_slots add column if not exists updated_at timestamptz default now();

alter table if exists mentoring_date_slots
  drop constraint if exists mentoring_date_slots_day_check;

alter table if exists mentoring_date_slots
  add constraint mentoring_date_slots_day_check check (day_of_week in (1, 2, 3, 4, 5));

create index if not exists idx_mentoring_date_slots_date_active
  on mentoring_date_slots(schedule_date, is_active, sort_order, start_time);

create index if not exists idx_mentoring_date_slots_template
  on mentoring_date_slots(template_slot_id, schedule_date, is_active);

create unique index if not exists idx_mentoring_date_slots_template_active_unique
  on mentoring_date_slots(schedule_date, template_slot_id)
  where is_active = true and template_slot_id is not null;

create unique index if not exists idx_mentoring_date_slots_label_time_active_unique
  on mentoring_date_slots(schedule_date, slot_label, start_time)
  where is_active = true;

drop trigger if exists set_timestamp_mentoring_date_slots on mentoring_date_slots;
create trigger set_timestamp_mentoring_date_slots
before update on mentoring_date_slots
for each row execute function public.set_updated_at();

create table if not exists mentoring_date_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  template_assignment_id uuid references mentoring_assignments(id) on delete set null,
  date_slot_id uuid references mentoring_date_slots(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  mentor_id uuid references mentoring_mentors(id) on delete set null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table mentoring_date_assignments add column if not exists schedule_date date;
alter table mentoring_date_assignments add column if not exists template_assignment_id uuid references mentoring_assignments(id) on delete set null;
alter table mentoring_date_assignments add column if not exists date_slot_id uuid references mentoring_date_slots(id) on delete cascade;
alter table mentoring_date_assignments add column if not exists student_id uuid references students(id) on delete cascade;
alter table mentoring_date_assignments add column if not exists mentor_id uuid references mentoring_mentors(id) on delete set null;
alter table mentoring_date_assignments add column if not exists note text;
alter table mentoring_date_assignments add column if not exists is_active boolean not null default true;
alter table mentoring_date_assignments add column if not exists created_at timestamptz default now();
alter table mentoring_date_assignments add column if not exists updated_at timestamptz default now();

create index if not exists idx_mentoring_date_assignments_date_active
  on mentoring_date_assignments(schedule_date, is_active);

create index if not exists idx_mentoring_date_assignments_slot_active
  on mentoring_date_assignments(date_slot_id, is_active);

create index if not exists idx_mentoring_date_assignments_student_date
  on mentoring_date_assignments(student_id, schedule_date, is_active);

create index if not exists idx_mentoring_date_assignments_mentor_active
  on mentoring_date_assignments(mentor_id, is_active);

create unique index if not exists idx_mentoring_date_assignments_slot_student_active_unique
  on mentoring_date_assignments(date_slot_id, student_id)
  where is_active = true;

create unique index if not exists idx_mentoring_date_assignments_student_date_active_unique
  on mentoring_date_assignments(student_id, schedule_date)
  where is_active = true;

create unique index if not exists idx_mentoring_date_assignments_template_active_unique
  on mentoring_date_assignments(schedule_date, template_assignment_id)
  where is_active = true and template_assignment_id is not null;

drop trigger if exists set_timestamp_mentoring_date_assignments on mentoring_date_assignments;
create trigger set_timestamp_mentoring_date_assignments
before update on mentoring_date_assignments
for each row execute function public.set_updated_at();
