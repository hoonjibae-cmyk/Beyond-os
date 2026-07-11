-- Beyond OS v26: planner_photos session_id 오류 핫픽스
-- 증상: planner_photos 저장 실패: null value in column "session_id" violates not-null constraint
-- 원인: 초기 planner_photos 테이블에 session_id NOT NULL 제약이 남아 있는 상태에서
--       v24/v25의 학생+날짜 기반 플래너 저장 로직이 session_id를 넣지 않아 발생.
-- 조치: session_id를 선택값으로 완화하고, 학생+날짜 단위 업로드를 안정화.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

alter table planner_photos add column if not exists session_id uuid references daily_sessions(id) on delete set null;
alter table planner_photos alter column session_id drop not null;

alter table planner_photos add column if not exists student_id uuid references students(id) on delete cascade;
alter table planner_photos add column if not exists planner_date date;
alter table planner_photos add column if not exists file_path text;
alter table planner_photos add column if not exists file_name text;
alter table planner_photos add column if not exists memo text;
alter table planner_photos add column if not exists uploaded_by text;
alter table planner_photos add column if not exists updated_at timestamptz default now();

-- 기존 데이터 중 planner_date가 비어 있고 session_id가 있는 경우 session_date로 보정
update planner_photos pp
set planner_date = ds.session_date
from daily_sessions ds
where pp.session_id = ds.id
  and pp.planner_date is null;

create unique index if not exists idx_planner_photos_student_date
on planner_photos(student_id, planner_date);

create index if not exists idx_planner_photos_session_id
on planner_photos(session_id);

create index if not exists idx_planner_photos_date
on planner_photos(planner_date);

drop trigger if exists set_timestamp_planner_photos on planner_photos;
create trigger set_timestamp_planner_photos
before update on planner_photos
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('planner-photos', 'planner-photos', false)
on conflict (id) do nothing;
