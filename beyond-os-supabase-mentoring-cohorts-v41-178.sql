-- Beyond OS v41-178: 멘토링 설정을 기수별로 관리
-- Supabase SQL Editor에서 1회 실행하세요.
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
create unique index if not exists idx_mentoring_mentor_students_unique_cohort
  on mentoring_mentor_students(cohort_id, mentor_id, student_id);

-- 중요: 기존에는 '학생 한 명당 활성 담당멘토 1명'이 전체 기준이었습니다.
-- 1기와 2기를 모두 듣는 학생은 기수마다 담당멘토가 달라질 수 있으므로
-- 이 제약도 기수 단위로 바꿉니다. (이걸 안 바꾸면 2기 담당학생 저장이 막힙니다)
drop index if exists idx_mentoring_mentor_students_active_student;
create unique index if not exists idx_mentoring_mentor_students_active_student_cohort
  on mentoring_mentor_students(cohort_id, student_id)
  where is_active = true;

comment on column mentoring_slots.cohort_id is '이 요일별 차시가 속한 기수 (v41-178)';
comment on column mentoring_mentor_students.cohort_id is '이 담당학생 지정이 속한 기수 (v41-178)';

-- 4) 확인용 ---------------------------------------------------------------
-- select c.name, s.day_of_week, count(*) as 차시수
-- from mentoring_slots s join cohorts c on c.id = s.cohort_id
-- group by 1, 2 order by 1, 2;
