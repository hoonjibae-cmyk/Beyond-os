-- Beyond OS v41-280: 상벌점 카테고리 · 상세 사유 칸
-- Supabase SQL Editor에서 1회 실행하세요. (실행 전에도 기록은 저장되며, 카테고리는 사유 문구에만 남습니다)
alter table student_points
  add column if not exists category text,
  add column if not exists reason_detail text;

comment on column student_points.category is '벌점 카테고리 이름 (v41-280). 상점은 비움';
comment on column student_points.reason_detail is '카테고리와 별개의 상세 사유 (v41-280)';
create index if not exists student_points_category_idx on student_points (category);
