-- Beyond OS v27: planner_photos 과거 스키마 호환 핫픽스
-- 오류 예:
-- null value in column "photo_url" of relation "planner_photos" violates not-null constraint
-- null value in column "session_id" of relation "planner_photos" violates not-null constraint

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
  session_id uuid references daily_sessions(id) on delete set null,
  planner_date date,
  file_path text,
  file_name text,
  photo_url text,
  memo text,
  uploaded_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table planner_photos add column if not exists student_id uuid references students(id) on delete cascade;
alter table planner_photos add column if not exists session_id uuid references daily_sessions(id) on delete set null;
alter table planner_photos add column if not exists planner_date date;
alter table planner_photos add column if not exists file_path text;
alter table planner_photos add column if not exists file_name text;
alter table planner_photos add column if not exists photo_url text;
alter table planner_photos add column if not exists memo text;
alter table planner_photos add column if not exists uploaded_by text;
alter table planner_photos add column if not exists updated_at timestamptz default now();

-- 과거 스키마의 NOT NULL 제약 완화
alter table planner_photos alter column session_id drop not null;
alter table planner_photos alter column photo_url drop not null;
alter table planner_photos alter column planner_date drop not null;
alter table planner_photos alter column file_path drop not null;
alter table planner_photos alter column file_name drop not null;

-- 과거 photo_url만 있던 데이터와 새 file_path 구조 동기화
update planner_photos
set file_path = coalesce(file_path, photo_url),
    photo_url = coalesce(photo_url, file_path)
where file_path is null or photo_url is null;

-- planner_date가 비어 있는 과거 데이터는 세션 날짜에서 보정
update planner_photos p
set planner_date = ds.session_date
from daily_sessions ds
where p.session_id = ds.id
  and p.planner_date is null;

-- 중복 인덱스 생성 전 기존 이름 충돌 방지
drop index if exists idx_planner_photos_student_date;

create unique index if not exists idx_planner_photos_student_date
on planner_photos(student_id, planner_date)
where student_id is not null and planner_date is not null;

create index if not exists idx_planner_photos_date
on planner_photos(planner_date);

drop trigger if exists set_timestamp_planner_photos on planner_photos;
create trigger set_timestamp_planner_photos
before update on planner_photos
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('planner-photos', 'planner-photos', false)
on conflict (id) do nothing;
