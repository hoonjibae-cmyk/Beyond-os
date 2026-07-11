-- Beyond OS v41-28: 학생 관리 이력 GPT 상담 요약 저장 테이블
-- 실행 위치: Supabase SQL Editor

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists student_counseling_summaries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  summary_type text not null default 'internal_weekly',
  generated_summary text,
  edited_summary text,
  source_payload jsonb not null default '{}'::jsonb,
  model_name text,
  status text not null default 'saved',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_counseling_summaries add column if not exists student_id uuid references students(id) on delete cascade;
alter table student_counseling_summaries add column if not exists start_date date;
alter table student_counseling_summaries add column if not exists end_date date;
alter table student_counseling_summaries add column if not exists summary_type text not null default 'internal_weekly';
alter table student_counseling_summaries add column if not exists generated_summary text;
alter table student_counseling_summaries add column if not exists edited_summary text;
alter table student_counseling_summaries add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table student_counseling_summaries add column if not exists model_name text;
alter table student_counseling_summaries add column if not exists status text not null default 'saved';
alter table student_counseling_summaries add column if not exists created_by text;
alter table student_counseling_summaries add column if not exists created_at timestamptz default now();
alter table student_counseling_summaries add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_student_counseling_summaries_unique
on student_counseling_summaries(student_id, start_date, end_date, summary_type);

create index if not exists idx_student_counseling_summaries_student_range
on student_counseling_summaries(student_id, start_date desc, end_date desc);

create index if not exists idx_student_counseling_summaries_updated
on student_counseling_summaries(updated_at desc);

drop trigger if exists set_timestamp_student_counseling_summaries on student_counseling_summaries;
create trigger set_timestamp_student_counseling_summaries
before update on student_counseling_summaries
for each row execute function public.set_updated_at();
