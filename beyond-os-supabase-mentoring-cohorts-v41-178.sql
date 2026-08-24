-- Beyond OS v41-178: 멘토링 설정을 기수별로 관리
-- Supabase SQL Editor에서 1회 실행하세요. (여러 번 실행해도 안전합니다)
--
-- v41-228 보강: 인덱스를 만들기 전에 중복 정리 단계를 넣었습니다.
--   증상 - 멘토별 담당학생을 저장하면 이런 오류가 납니다.
--          duplicate key value violates unique constraint
--          "idx_mentoring_mentor_students_active_student"
--   원인 - 저 인덱스는 기수 구분이 없는 옛 인덱스입니다. 1기에 이미 담당으로
--          걸려 있는 학생을 2기 담당으로 저장하려 하면 막힙니다.
--          이 SQL이 그 인덱스를 기수 단위로 바꿔 줍니다.
--
-- 기수가 바뀌면 멘토링 요일과 차시 구성이 통째로 달라집니다.
-- 요일별 템플릿(mentoring_slots)과 멘토별 담당학생(mentoring_mentor_students)에
-- 기수 구분을 넣고, 지금까지 저장된 설정은 전부 '가장 먼저 시작한 기수'(= 1기)로 옮깁니다.
--
-- 날짜별 멘토링(mentoring_date_slots / mentoring_date_assignments)은 날짜 자체가
-- 기수를 가리키므로 손대지 않습니다.
-- 요일별 학생 배정(mentoring_assignments)은 slot_id 로 템플릿에 매달려 있어
-- 템플릿을 따라 자동으로 기수가 갈립니다.

-- 1) 기수 구분 컬럼 -------------------------------------------------------
alter table mentoring_slots
  add column if not exists cohort_id uuid references cohorts(id) on delete cascade;

alter table mentoring_mentor_students
  add column if not exists cohort_id uuid references cohorts(id) on delete cascade;

-- 2) 기존 설정을 1기(가장 먼저 시작한 기수)로 몰아넣기 ---------------------
do $$
declare
  first_cohort_id uuid;
  moved_slots int := 0;
  moved_links int := 0;
begin
  select id into first_cohort_id
  from cohorts
  order by start_date asc, created_at asc
  limit 1;

  if first_cohort_id is null then
    raise notice 'cohorts 테이블에 기수가 없습니다. 기수를 먼저 등록한 뒤 이 SQL을 다시 실행하세요.';
    return;
  end if;

  update mentoring_slots set cohort_id = first_cohort_id where cohort_id is null;
  get diagnostics moved_slots = row_count;

  update mentoring_mentor_students set cohort_id = first_cohort_id where cohort_id is null;
  get diagnostics moved_links = row_count;

  raise notice '기존 멘토링 설정을 기수 %(가장 먼저 시작한 기수)로 옮겼습니다. 차시 %건, 담당학생 %건',
    first_cohort_id, moved_slots, moved_links;
end $$;

-- 3) 중복 방지 인덱스를 기수 단위로 다시 만들기 ---------------------------
-- 기존: (요일, 차시명, 시작시간)  →  변경: (기수, 요일, 차시명, 시작시간)
-- 이렇게 해야 2기에서 1기와 같은 이름/시간의 차시를 새로 만들 수 있습니다.
drop index if exists idx_mentoring_slots_unique;
create unique index if not exists idx_mentoring_slots_unique_cohort
  on mentoring_slots(cohort_id, day_of_week, slot_label, start_time);

create index if not exists idx_mentoring_slots_cohort_day
  on mentoring_slots(cohort_id, day_of_week, sort_order, start_time);

create index if not exists idx_mentoring_mentor_students_cohort
  on mentoring_mentor_students(cohort_id, mentor_id);

-- 멘토별 담당학생도 기수마다 따로 잡히도록 합니다.
drop index if exists idx_mentoring_mentor_students_unique;

-- v41-228: 새 인덱스를 만들기 전에 중복 행을 먼저 정리합니다.
-- 옛 인덱스가 이미 지워진 상태에서 이 SQL을 돌리면 그 사이에 중복이 생겼을 수
-- 있고, 그러면 아래 unique index 생성이 실패하면서 스크립트가 중간에 멈춥니다.
-- (컬럼만 생기고 인덱스는 없는 어중간한 상태가 바로 그렇게 만들어집니다)
-- 같은 (기수, 멘토, 학생) 조합이 여러 줄이면 최신 한 줄만 남깁니다.
with ranked as (
  select
    id,
    row_number() over (
      partition by cohort_id, mentor_id, student_id
      order by is_active desc, updated_at desc nulls last, created_at desc nulls last, id
    ) as rn
  from mentoring_mentor_students
  where mentor_id is not null and student_id is not null
)
delete from mentoring_mentor_students m
using ranked r
where m.id = r.id and r.rn > 1;

create unique index if not exists idx_mentoring_mentor_students_unique_cohort
  on mentoring_mentor_students(cohort_id, mentor_id, student_id);

-- 중요: 기존에는 '학생 한 명당 활성 담당멘토 1명'이 전체 기준이었습니다.
-- 1기와 2기를 모두 듣는 학생은 기수마다 담당멘토가 달라질 수 있으므로
-- 이 제약도 기수 단위로 바꿉니다. (이걸 안 바꾸면 2기 담당학생 저장이 막힙니다)
drop index if exists idx_mentoring_mentor_students_active_student;

-- v41-228: 같은 이유로 활성 중복도 먼저 정리합니다.
-- 한 기수 안에서 같은 학생이 여러 멘토에게 활성으로 걸려 있으면 최신 한 건만
-- 남기고 나머지는 비활성으로 내립니다. (지우지 않고 기록은 남깁니다)
with ranked_active as (
  select
    id,
    row_number() over (
      partition by cohort_id, student_id
      order by updated_at desc nulls last, created_at desc nulls last, id
    ) as rn
  from mentoring_mentor_students
  where is_active = true and student_id is not null
)
update mentoring_mentor_students m
set is_active = false
from ranked_active r
where m.id = r.id and r.rn > 1;

create unique index if not exists idx_mentoring_mentor_students_active_student_cohort
  on mentoring_mentor_students(cohort_id, student_id)
  where is_active = true;

comment on column mentoring_slots.cohort_id is '이 요일별 차시가 속한 기수 (v41-178)';
comment on column mentoring_mentor_students.cohort_id is '이 담당학생 지정이 속한 기수 (v41-178)';

-- 4) 확인용 ---------------------------------------------------------------
-- select c.name, s.day_of_week, count(*) as 차시수
-- from mentoring_slots s join cohorts c on c.id = s.cohort_id
-- group by 1, 2 order by 1, 2;
