-- Beyond OS v24: 데일리 플래너 업로드
-- Supabase SQL Editor에서 1회 실행하세요.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists planner_photos (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  planner_date date not null,
  file_path text,
  file_name text,
  memo text,
  uploaded_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table planner_photos add column if not exists planner_date date;
alter table planner_photos add column if not exists file_path text;
alter table planner_photos add column if not exists file_name text;
alter table planner_photos add column if not exists memo text;
alter table planner_photos add column if not exists uploaded_by text;
alter table planner_photos add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_planner_photos_student_date
on planner_photos(student_id, planner_date);

create index if not exists idx_planner_photos_date
on planner_photos(planner_date);

drop trigger if exists set_timestamp_planner_photos on planner_photos;
create trigger set_timestamp_planner_photos
before update on planner_photos
for each row execute function public.set_updated_at();

-- Storage bucket. 이미 있으면 무시됩니다.
insert into storage.buckets (id, name, public)
values ('planner-photos', 'planner-photos', false)
on conflict (id) do nothing;
