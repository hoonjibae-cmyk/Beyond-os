-- Beyond OS v41-148: 기수(코호트) 운영
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   비욘드 스터디카페는 기수제로 운영됩니다. (예: 2026-07-21 ~ 2026-08-16 "비욘드 1기")
--   특정 기간을 하나의 기수로 묶고, 기수별로 명단을 관리해
--   순공시간·랭킹·리포트를 기수 단위로 분리해서 볼 수 있게 합니다.
--
-- 설계 메모
--   - 학생 정보(students)는 기수가 바뀌어도 그대로 유지됩니다.
--     기수별 "수강 명단"만 cohort_students 로 따로 관리합니다.
--     → 2기를 신청하지 않은 학생은 2기 명단에서 빠지고, 신규 학생은 추가됩니다.
--   - 출결/순공 원본(daily_sessions 등)에는 기수 컬럼을 두지 않습니다.
--     기수는 "기간 + 명단"으로 정의되므로 날짜 범위와 명단으로 집계하면 충분하고,
--     기간을 나중에 수정해도 과거 데이터를 다시 손볼 필요가 없습니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 기수 ─────────────────────────────────────────────────────
create table if not exists cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  sort_order integer not null default 0,
  memo text,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table cohorts add column if not exists name text;
alter table cohorts add column if not exists start_date date;
alter table cohorts add column if not exists end_date date;
alter table cohorts add column if not exists sort_order integer not null default 0;
alter table cohorts add column if not exists memo text;
alter table cohorts add column if not exists is_active boolean not null default true;
alter table cohorts add column if not exists created_by text;
alter table cohorts add column if not exists created_at timestamptz default now();
alter table cohorts add column if not exists updated_at timestamptz default now();

create index if not exists idx_cohorts_range on cohorts(start_date, end_date);
create index if not exists idx_cohorts_active on cohorts(is_active, start_date desc);

drop trigger if exists set_timestamp_cohorts on cohorts;
create trigger set_timestamp_cohorts
before update on cohorts
for each row execute function public.set_updated_at();

-- ── 기수별 수강 명단 ─────────────────────────────────────────
create table if not exists cohort_students (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  is_active boolean not null default true,
  memo text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table cohort_students add column if not exists cohort_id uuid references cohorts(id) on delete cascade;
alter table cohort_students add column if not exists student_id uuid references students(id) on delete cascade;
alter table cohort_students add column if not exists is_active boolean not null default true;
alter table cohort_students add column if not exists memo text;
alter table cohort_students add column if not exists created_by text;
alter table cohort_students add column if not exists created_at timestamptz default now();
alter table cohort_students add column if not exists updated_at timestamptz default now();

-- 같은 기수에 같은 학생이 두 번 들어가지 않도록 합니다.
create unique index if not exists idx_cohort_students_unique
  on cohort_students(cohort_id, student_id);

create index if not exists idx_cohort_students_cohort
  on cohort_students(cohort_id, is_active);

create index if not exists idx_cohort_students_student
  on cohort_students(student_id, is_active);

drop trigger if exists set_timestamp_cohort_students on cohort_students;
create trigger set_timestamp_cohort_students
before update on cohort_students
for each row execute function public.set_updated_at();

comment on table cohorts is '기수. 기간(start_date~end_date)으로 정의합니다.';
comment on table cohort_students is '기수별 수강 명단. 학생 원본 정보는 students에 그대로 유지됩니다.';
