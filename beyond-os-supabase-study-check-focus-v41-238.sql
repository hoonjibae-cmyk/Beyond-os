-- Beyond OS v41-238: 순찰 체크에 집중도 별점
-- Supabase SQL Editor에서 1회 실행하세요. (여러 번 실행해도 안전합니다)
--
-- 순찰하며 학습 상태를 체크할 때 집중도를 별 1~5로 함께 남깁니다.
-- 하루치를 평균 내 '오늘의 집중도 OO%'로 보여 줍니다.
--
-- 0 은 '별점을 매기지 않음'입니다. 집중도 0% 가 아닙니다.
-- 평균을 낼 때 0 인 체크는 아예 빼야 별점을 안 매긴 체크가 평균을
-- 끌어내리지 않습니다. (기본값이 0 이므로 지난 기록은 자동으로 빠집니다)

alter table study_checks
  add column if not exists focus_rating smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'study_checks_focus_rating_check'
  ) then
    alter table study_checks
      add constraint study_checks_focus_rating_check
      check (focus_rating between 0 and 5);
  end if;
end $$;

comment on column study_checks.focus_rating is '순찰 시 매긴 집중도 별점 (1~5, 0이면 매기지 않음) — v41-238';
