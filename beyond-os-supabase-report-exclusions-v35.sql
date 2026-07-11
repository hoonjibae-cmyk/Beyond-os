-- Beyond OS v35: 데일리 리포트 발송 제외 관리
-- 학생별/일자별로 오늘 발송 제외 여부와 사유를 저장합니다.

create table if not exists report_send_exclusions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references daily_sessions(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  report_date date not null,
  is_excluded boolean not null default true,
  reason text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_report_send_exclusions_session
on report_send_exclusions(session_id);

create index if not exists idx_report_send_exclusions_date
on report_send_exclusions(report_date);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_report_send_exclusions on report_send_exclusions;
create trigger set_timestamp_report_send_exclusions
before update on report_send_exclusions
for each row execute function public.set_updated_at();
