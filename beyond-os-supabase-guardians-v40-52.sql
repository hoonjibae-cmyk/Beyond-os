-- Beyond OS v40-52: 학생별 보호자 연락처 다중 관리
-- Supabase SQL Editor에서 1회 실행하세요.
-- 목적:
-- 1) 학생 1명에게 보호자 연락처를 여러 개 등록
-- 2) 데일리/위클리 리포트 수신 여부를 보호자별로 관리
-- 3) 기존 students.parent_phone 값은 대표 보호자로 자동 이관
-- 4) 기존 parent_phone 컬럼은 호환용으로 유지

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists student_guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  guardian_name text,
  relationship text not null default '모',
  phone text,
  is_primary boolean not null default false,
  receive_daily_report boolean not null default true,
  receive_weekly_report boolean not null default true,
  is_active boolean not null default true,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_guardians add column if not exists guardian_name text;
alter table student_guardians add column if not exists relationship text not null default '모';
alter table student_guardians add column if not exists phone text;
alter table student_guardians add column if not exists is_primary boolean not null default false;
alter table student_guardians add column if not exists receive_daily_report boolean not null default true;
alter table student_guardians add column if not exists receive_weekly_report boolean not null default true;
alter table student_guardians add column if not exists is_active boolean not null default true;
alter table student_guardians add column if not exists memo text;
alter table student_guardians add column if not exists created_at timestamptz default now();
alter table student_guardians add column if not exists updated_at timestamptz default now();

create index if not exists idx_student_guardians_student_id
on student_guardians(student_id);

create index if not exists idx_student_guardians_daily_active
on student_guardians(student_id, receive_daily_report, is_active);

create index if not exists idx_student_guardians_weekly_active
on student_guardians(student_id, receive_weekly_report, is_active);

drop trigger if exists set_timestamp_student_guardians on student_guardians;
create trigger set_timestamp_student_guardians
before update on student_guardians
for each row execute function public.set_updated_at();

-- 학생별 대표 보호자는 1명만 유지합니다.
create unique index if not exists idx_student_guardians_one_primary
on student_guardians(student_id)
where is_primary = true and is_active = true;

-- 기존 students.parent_phone 값을 보호자 테이블로 1회 이관합니다.
insert into student_guardians (
  student_id,
  guardian_name,
  relationship,
  phone,
  is_primary,
  receive_daily_report,
  receive_weekly_report,
  is_active,
  memo
)
select
  s.id,
  null,
  '모',
  s.parent_phone,
  true,
  true,
  true,
  true,
  'v40-52 기존 students.parent_phone 자동 이관'
from students s
where s.parent_phone is not null
  and trim(s.parent_phone) <> ''
  and not exists (
    select 1
    from student_guardians g
    where g.student_id = s.id
      and regexp_replace(coalesce(g.phone, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g')
  );

-- 대표 보호자가 없는 학생은 가장 오래된 활성 보호자 1명을 대표로 지정합니다.
with ranked as (
  select
    id,
    row_number() over (partition by student_id order by created_at asc, id asc) as rn
  from student_guardians
  where is_active = true
    and phone is not null
    and trim(phone) <> ''
    and student_id not in (
      select student_id from student_guardians where is_primary = true and is_active = true
    )
)
update student_guardians
set is_primary = true
where id in (select id from ranked where rn = 1);
