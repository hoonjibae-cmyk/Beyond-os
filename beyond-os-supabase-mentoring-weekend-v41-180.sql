-- Beyond OS v41-180: 멘토링 요일을 토·일까지 허용
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 지금까지 멘토링 차시는 평일(월~금)만 만들 수 있었습니다.
-- (v41-30 은 월·수·금만, v41-31.3 에서 화·목까지 열어 월~금이 된 상태)
-- 기수에 따라 토요일 멘토링을 운영할 수 있어야 하므로 요일 제한을 풉니다.
--
-- 0=일요일 ~ 6=토요일 (Postgres/JS 요일 번호와 같습니다)
-- 실제로 어떤 요일을 쓸지는 설정 · 멘토링 기본 설정의 [운영 기준]에서 기수별로 고릅니다.
-- 이 SQL 은 '가능한 범위'만 넓히는 것이고, 이걸 실행한다고 요일이 늘어나지는 않습니다.

-- 1) 요일별 차시 템플릿 ----------------------------------------------------
alter table if exists mentoring_slots
  drop constraint if exists mentoring_slots_day_check;

alter table if exists mentoring_slots
  add constraint mentoring_slots_day_check check (day_of_week between 0 and 6);

-- 2) 날짜별 차시 ------------------------------------------------------------
alter table if exists mentoring_date_slots
  drop constraint if exists mentoring_date_slots_day_check;

alter table if exists mentoring_date_slots
  add constraint mentoring_date_slots_day_check check (day_of_week between 0 and 6);

-- 확인용 -------------------------------------------------------------------
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conname in ('mentoring_slots_day_check', 'mentoring_date_slots_day_check');
