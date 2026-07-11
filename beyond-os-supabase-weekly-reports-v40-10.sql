-- Beyond OS v40-10: 위클리 리포트 저장 테이블
-- 학생별 월요일~일요일 주간 리포트, 원장님 주간면담 내용, AI 주간 총평 초안, 최종 리포트 전문을 저장합니다.

create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  summary_payload jsonb not null default '{}'::jsonb,
  director_interview text,
  ai_weekly_comment text,
  final_weekly_comment text,
  report_text text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_weekly_reports_student_range
on weekly_reports(student_id, start_date, end_date);

create index if not exists idx_weekly_reports_student_id
on weekly_reports(student_id);

create index if not exists idx_weekly_reports_range
on weekly_reports(start_date, end_date);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_weekly_reports on weekly_reports;
create trigger set_timestamp_weekly_reports
before update on weekly_reports
for each row execute function public.set_updated_at();
