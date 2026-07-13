-- Beyond OS v41-57: 학생 사전 설문 (학생용/학부모용) bulk 업로드 저장
-- Supabase SQL Editor에서 1회 실행하세요. (기존 스키마 실행 후 추가)
-- 구글폼 응답 엑셀을 업로드하면 학생별로 설문 응답을 저장/조회합니다.

create table if not exists student_surveys (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete set null,
  survey_type text not null check (survey_type in ('student', 'parent')),
  student_name text not null,
  school_grade text,
  respondent_name text,                 -- 학부모 설문의 보호자 성함
  submitted_at timestamptz,             -- 설문 타임스탬프
  answers jsonb not null default '[]'::jsonb,  -- [{ section, question, answer }] 순서 보존
  matched boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- 같은 유형·같은 사람(이름+학교/학년)의 설문은 재업로드 시 최신으로 덮어씁니다.
  unique (survey_type, student_name, school_grade)
);

create index if not exists idx_student_surveys_student on student_surveys(student_id);
create index if not exists idx_student_surveys_type on student_surveys(survey_type);

-- updated_at 자동 갱신 (set_updated_at 함수는 기존 스키마에서 생성됨)
drop trigger if exists trg_student_surveys_updated_at on student_surveys;
create trigger trg_student_surveys_updated_at
  before update on student_surveys
  for each row execute function set_updated_at();
