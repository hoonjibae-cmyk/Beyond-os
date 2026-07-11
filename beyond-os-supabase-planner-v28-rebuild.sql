-- Beyond OS v28: planner_photos 구조 재정비 / ON CONFLICT 제거 대응
-- 핵심:
-- 1) 과거 session_id, photo_url NOT NULL 제약 제거
-- 2) 학생+날짜 기준 업로드가 가능하도록 컬럼 정리
-- 3) 기존 중복 데이터 정리 후 일반 unique index 생성
-- 4) v28 API는 upsert/onConflict를 쓰지 않지만, DB도 안정적으로 정리

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
alter table planner_photos add column if not exists created_at timestamptz default now();
alter table planner_photos add column if not exists updated_at timestamptz default now();

-- 과거 필수값 제약 제거
alter table planner_photos alter column session_id drop not null;
alter table planner_photos alter column photo_url drop not null;
alter table planner_photos alter column student_id drop not null;
alter table planner_photos alter column planner_date drop not null;
alter table planner_photos alter column file_path drop not null;
alter table planner_photos alter column file_name drop not null;

-- 과거 photo_url / 새 file_path 동기화
update planner_photos
set file_path = coalesce(file_path, photo_url),
    photo_url = coalesce(photo_url, file_path)
where file_path is null or photo_url is null;

-- 세션 기반 과거 데이터 보정
update planner_photos p
set student_id = ds.student_id,
    planner_date = ds.session_date
from daily_sessions ds
where p.session_id = ds.id
  and (p.student_id is null or p.planner_date is null);

-- 중복 제거: 같은 학생/날짜가 여러 행이면 최신 1개만 남김
with ranked as (
  select
    id,
    row_number() over (
      partition by student_id, planner_date
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from planner_photos
  where student_id is not null
    and planner_date is not null
)
delete from planner_photos p
using ranked r
where p.id = r.id
  and r.rn > 1;

drop index if exists idx_planner_photos_student_date;
drop index if exists planner_photos_student_date_key;

create unique index if not exists idx_planner_photos_student_date
on planner_photos(student_id, planner_date);

create index if not exists idx_planner_photos_date
on planner_photos(planner_date);

drop trigger if exists set_timestamp_planner_photos on planner_photos;
create trigger set_timestamp_planner_photos
before update on planner_photos
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('planner-photos', 'planner-photos', false)
on conflict (id) do nothing;
