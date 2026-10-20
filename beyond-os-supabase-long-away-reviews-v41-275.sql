-- Beyond OS v41-275: 자율학습 중 장시간 외출 — 벌점 확인 결정 기록
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 무엇에 쓰나
--   매일 전날 '외출 → 복귀'로 닫힌 외출 중 자율학습 시간대에 40분 이상 겹친 건을 명단으로 보여 주고,
--   관리자가 건마다 [벌점 부여] 또는 [사유 있음 · 제외]를 고릅니다. 그 결정을 여기 남겨
--   같은 건이 다음 날 다시 뜨지 않게 합니다.

create table if not exists long_away_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  session_date date not null,
  session_id uuid,
  away_event_id text not null,
  return_event_id text,
  away_started_at timestamptz,
  returned_at timestamptz,
  away_minutes integer not null default 0,
  self_study_minutes integer not null default 0,
  decision text not null check (decision in ('penalty', 'skip')),
  points integer not null default 0,
  note text,
  point_id uuid,
  decided_by text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists long_away_reviews_event_uidx on long_away_reviews (away_event_id);
create index if not exists long_away_reviews_date_idx on long_away_reviews (session_date);
create index if not exists long_away_reviews_student_idx on long_away_reviews (student_id, session_date);

comment on table long_away_reviews is '자율학습 중 장시간 외출 벌점 확인 결정 (v41-275)';
comment on column long_away_reviews.decision is 'penalty = 벌점 부여(student_points 연결) · skip = 사유 있음, 제외';
