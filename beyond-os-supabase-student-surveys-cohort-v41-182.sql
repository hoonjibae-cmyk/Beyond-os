-- Beyond OS v41-182: 사전 설문을 기수별로 분리 보관
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 문제
--   student_surveys 에는 기수 개념이 없었습니다.
--   중복 방지 키가 (survey_type, student_name, school_grade) 뿐이라,
--   2기 설문 엑셀을 올리면 이름·학교/학년이 같은 1기 응답을 덮어써 버렸습니다.
--   반대로 school_grade 가 비어 있으면(NULL) 유니크 충돌이 나지 않아
--   같은 파일을 다시 올릴 때마다 중복 행이 쌓였습니다. (NULL 은 서로 다른 값으로 취급)
--
-- 조치
--   1) cohort_id 컬럼 추가 (기수 삭제 시에는 설문을 지우지 않고 연결만 끊습니다)
--   2) 기존 응답은 전부 가장 먼저 시작한 기수(=1기)로 귀속
--   3) 쌓여 있던 중복 행 정리 (같은 키는 가장 최근 것만 남김)
--   4) 옛 유니크 제약 제거 → 기수를 포함한 새 유니크 인덱스로 교체
--      NULL 때문에 중복이 새는 문제를 막으려고 coalesce 로 감쌉니다.

-- 1) 기수 컬럼 ---------------------------------------------------------------
alter table if exists student_surveys
  add column if not exists cohort_id uuid references cohorts(id) on delete set null;

-- 2) 기존 응답을 가장 먼저 시작한 기수로 귀속 ---------------------------------
--    (기수 기능을 쓰기 전에 올린 설문 = 1기 설문입니다)
update student_surveys
set cohort_id = (select id from cohorts order by start_date asc, created_at asc limit 1)
where cohort_id is null
  and exists (select 1 from cohorts);

-- 3) 중복 행 정리 -------------------------------------------------------------
--    같은 (기수, 유형, 이름, 학교/학년) 조합에서 가장 최근 것만 남깁니다.
delete from student_surveys s
using student_surveys t
where s.id <> t.id
  and s.survey_type = t.survey_type
  and s.student_name = t.student_name
  and coalesce(s.school_grade, '') = coalesce(t.school_grade, '')
  and coalesce(s.cohort_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(t.cohort_id, '00000000-0000-0000-0000-000000000000'::uuid)
  and (
    coalesce(s.updated_at, s.created_at) < coalesce(t.updated_at, t.created_at)
    or (
      coalesce(s.updated_at, s.created_at) = coalesce(t.updated_at, t.created_at)
      and s.id < t.id
    )
  );

-- 4) 유니크 키 교체 -----------------------------------------------------------
--    옛 제약 (survey_type, student_name, school_grade) 을 걷어냅니다.
--    이름이 자동 생성이라 컬럼 구성으로 찾아서 지웁니다. (기본키 contype='p' 는 건드리지 않습니다)
do $$
declare
  target record;
begin
  for target in
    select conname
    from pg_constraint
    where conrelid = 'student_surveys'::regclass
      and contype = 'u'
  loop
    execute format('alter table student_surveys drop constraint %I', target.conname);
  end loop;
end $$;

drop index if exists idx_student_surveys_unique;

create unique index idx_student_surveys_unique on student_surveys (
  coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid),
  survey_type,
  student_name,
  coalesce(school_grade, '')
);

create index if not exists idx_student_surveys_cohort on student_surveys(cohort_id, survey_type);

comment on column student_surveys.cohort_id is
  '설문을 올린 시점의 [기수 보기]. 같은 학생이라도 기수가 다르면 별도 응답으로 보관합니다.';

-- 확인용 ---------------------------------------------------------------------
-- select c.name as cohort, s.survey_type, count(*)
-- from student_surveys s
-- left join cohorts c on c.id = s.cohort_id
-- group by 1, 2
-- order by 1, 2;
