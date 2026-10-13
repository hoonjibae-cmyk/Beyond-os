-- Beyond OS v41-268: 등록불가 학생 메뉴 — 표시한 기수를 함께 기록
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- v41-266 SQL을 실행했든 안 했든 이 파일 하나만 실행하면 됩니다.
-- (v41-266 의 칸 정의를 그대로 포함하고, 그 위에 '표시한 기수' 두 칸을 더합니다)
--
-- 무엇이 바뀌나
--   메인 메뉴 [등록불가 학생]에서 1기 등록불가 / 2기 등록불가 … 로 기수별 표를 보여 줍니다.
--   그러려면 "어느 기수에서 등록불가로 표시했는지"를 남겨야 하므로, 표시할 때 그날의 기수를
--   id 와 이름으로 함께 저장합니다. (이름을 같이 두는 이유: 기수를 지우거나 이름을 바꿔도
--   표에는 당시 이름이 남아야 합니다)

alter table students
  add column if not exists enrollment_blocked boolean not null default false,
  add column if not exists enrollment_block_reason text,
  add column if not exists enrollment_block_updated_at timestamptz,
  add column if not exists enrollment_block_updated_by text,
  add column if not exists enrollment_block_cohort_id uuid,
  add column if not exists enrollment_block_cohort_name text;

comment on column students.enrollment_block_cohort_id is '등록불가로 표시한 날이 속한 기수 (v41-268)';
comment on column students.enrollment_block_cohort_name is '표시 당시 기수 이름. 기수가 바뀌거나 지워져도 표에 남깁니다.';

-- 이미 표시된 학생(v41-266 으로 표시, 기수 미기록)은 표시한 날짜가 속한 기수로 채웁니다.
-- 기간이 겹치는 기수가 있으면 나중에 시작한 기수를 씁니다.
update students s
set enrollment_block_cohort_id = c.id,
    enrollment_block_cohort_name = c.name
from (
  select distinct on (st.id) st.id as student_id, co.id, co.name
  from students st
  join cohorts co
    on (st.enrollment_block_updated_at at time zone 'Asia/Seoul')::date between co.start_date and co.end_date
  where st.enrollment_blocked = true
    and st.enrollment_block_cohort_id is null
    and st.enrollment_block_updated_at is not null
  order by st.id, co.start_date desc
) c
where s.id = c.student_id;
