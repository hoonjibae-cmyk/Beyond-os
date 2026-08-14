-- Beyond OS v41-167: 학생 신청 상품 카테고리
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 2기부터 신청 상품이 세 가지로 나뉩니다.
--   lite    : 기본 상품 (자리만 제공. 멘토링·학습 코칭 없음)
--   plus    : Lite + 학습 코칭
--   premium : Plus + 수행평가
--
-- 1기 학생처럼 값이 없는 경우(null)는 지금까지와 똑같이 아무 표시 없이 동작합니다.
-- 그래서 기본값을 두지 않고 비워 둡니다.

alter table students add column if not exists product_tier text;

-- 정해진 값만 들어가도록 막습니다. (null 은 허용 — 미분류)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'students_product_tier_check'
  ) then
    alter table students
      add constraint students_product_tier_check
      check (product_tier is null or product_tier in ('lite', 'plus', 'premium'));
  end if;
end $$;

create index if not exists idx_students_product_tier on students(product_tier);

comment on column students.product_tier is '신청 상품 카테고리 (lite/plus/premium, null이면 미분류)';
