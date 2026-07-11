-- Beyond OS v40-90: 학생별 상벌점 관리
-- Supabase SQL Editor에서 1회 실행하세요.
-- 목적: 학생별 상점/벌점을 수시로 기록하고 데일리/위클리 리포트에 반영합니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists student_points (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  point_date date not null default current_date,
  point_type text not null check (point_type in ('reward', 'penalty')),
  points integer not null check (points > 0),
  reason text not null,
  memo text,
  created_by text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_points add column if not exists student_id text;
alter table student_points add column if not exists point_date date not null default current_date;
alter table student_points add column if not exists point_type text;
alter table student_points add column if not exists points integer;
alter table student_points add column if not exists reason text;
alter table student_points add column if not exists memo text;
alter table student_points add column if not exists created_by text;
alter table student_points add column if not exists is_deleted boolean not null default false;
alter table student_points add column if not exists deleted_at timestamptz;
alter table student_points add column if not exists deleted_by text;
alter table student_points add column if not exists created_at timestamptz default now();
alter table student_points add column if not exists updated_at timestamptz default now();

create index if not exists idx_student_points_student_date
on student_points(student_id, point_date desc)
where is_deleted = false;

create index if not exists idx_student_points_date
on student_points(point_date desc)
where is_deleted = false;

drop trigger if exists set_timestamp_student_points on student_points;
create trigger set_timestamp_student_points
before update on student_points
for each row execute function public.set_updated_at();
