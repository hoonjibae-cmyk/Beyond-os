-- Beyond OS v41-235: 플래너 사진 회전값
-- Supabase SQL Editor에서 1회 실행하세요. (여러 번 실행해도 안전합니다)
--
-- 왜 사진을 다시 만들지 않고 각도만 저장하는가
--   리포트는 열어 볼 때마다 저장된 사진을 그대로 그립니다. 그래서 각도만
--   따로 저장해 두면, 이미 발송한 리포트도 다음에 열 때 바로 선 사진으로
--   보입니다. 사진 파일을 다시 만들면 이미 나간 링크는 고칠 수 없습니다.
--
--   0 / 90 / 180 / 270 만 들어갑니다. 시계 방향 각도입니다.

alter table planner_photos
  add column if not exists rotation smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planner_photos_rotation_check'
  ) then
    alter table planner_photos
      add constraint planner_photos_rotation_check
      check (rotation in (0, 90, 180, 270));
  end if;
end $$;

comment on column planner_photos.rotation is '리포트에서 사진을 돌려 보여 줄 각도 (0/90/180/270, 시계 방향) — v41-235';
