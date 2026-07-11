-- Beyond OS v41-31.3: 화/목 임시 멘토링 차시 허용
-- 실행 위치: Supabase SQL Editor
-- 목적: 기존 월/수/금만 허용하던 mentoring_slots.day_of_week 제약조건을 평일(월~금) 허용으로 확장합니다.
-- 주의: 기본 차시는 계속 월/수/금만 생성됩니다. 화/목은 앱의 차시 추가 기능으로 필요한 경우에만 생성합니다.

alter table if exists mentoring_slots
  drop constraint if exists mentoring_slots_day_check;

alter table if exists mentoring_slots
  add constraint mentoring_slots_day_check check (day_of_week in (1, 2, 3, 4, 5));
