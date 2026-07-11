-- Beyond OS v41-31.4: 멘토별 담당학생 설정
-- 실행 위치: Supabase SQL Editor
-- 목적: 관리자가 멘토별 담당학생을 사전에 지정하고, 멘토링 배정 화면에서 담당/비담당 학생을 시각적으로 구분합니다.
-- 주의: 이 SQL은 v41-31 및 v41-31.3 SQL 실행 이후 적용하는 추가 패치입니다.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists mentoring_mentor_students (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references mentoring_mentors(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  sort_order integer not null default 99,
  note text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table mentoring_mentor_students add column if not exists mentor_id uuid references mentoring_mentors(id) on delete cascade;
alter table mentoring_mentor_students add column if not exists student_id uuid references students(id) on delete cascade;
alter table mentoring_mentor_students add column if not exists sort_order integer not null default 99;
alter table mentoring_mentor_students add column if not exists note text;
alter table mentoring_mentor_students add column if not exists is_active boolean not null default true;
alter table mentoring_mentor_students add column if not exists created_at timestamptz default now();
alter table mentoring_mentor_students add column if not exists updated_at timestamptz default now();

-- 기존 테스트 데이터가 중복되어 있어도 unique index 생성이 실패하지 않도록 정리합니다.
with ranked as (
  select
    id,
    row_number() over (partition by mentor_id, student_id order by is_active desc, updated_at desc nulls last, created_at desc nulls last, id) as rn
  from mentoring_mentor_students
  where mentor_id is not null and student_id is not null
)
delete from mentoring_mentor_students
where id in (select id from ranked where rn > 1);

with ranked as (
  select
    id,
    row_number() over (partition by student_id order by updated_at desc nulls last, created_at desc nulls last, id) as rn
  from mentoring_mentor_students
  where is_active = true and student_id is not null
)
update mentoring_mentor_students
set is_active = false, updated_at = now()
where id in (select id from ranked where rn > 1);

create unique index if not exists idx_mentoring_mentor_students_unique
  on mentoring_mentor_students(mentor_id, student_id);

create unique index if not exists idx_mentoring_mentor_students_active_student
  on mentoring_mentor_students(student_id)
  where is_active = true;

create index if not exists idx_mentoring_mentor_students_mentor_active
  on mentoring_mentor_students(mentor_id, is_active, sort_order);

create index if not exists idx_mentoring_mentor_students_student_active
  on mentoring_mentor_students(student_id, is_active);

drop trigger if exists set_timestamp_mentoring_mentor_students on mentoring_mentor_students;
create trigger set_timestamp_mentoring_mentor_students
before update on mentoring_mentor_students
for each row execute function public.set_updated_at();
