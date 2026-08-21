-- Beyond OS v41-216: 학생별 음악 청취 허용 범위
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 학부모가 세 단계 중 하나를 정합니다.
--   none  : 이어폰 사용 불가
--   noise : 노이즈 캔슬링 허용 (소음 차단만, 음악 재생 불가)
--   music : 음악·백색소음 허용
--
-- 아직 정하지 않은 학생은 null(미정)로 둡니다.
-- 기본값을 정해 두면 '정하지 않음'과 '허용함'을 구분할 수 없게 되므로 비워 둡니다.

alter table students add column if not exists audio_policy text;

-- 정해진 값만 들어가도록 막습니다. (null 은 허용 — 미정)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'students_audio_policy_check'
  ) then
    alter table students
      add constraint students_audio_policy_check
      check (audio_policy is null or audio_policy in ('none', 'noise', 'music'));
  end if;
end $$;

create index if not exists idx_students_audio_policy on students(audio_policy);

comment on column students.audio_policy is '음악 청취 허용 범위 (none/noise/music, null이면 미정)';
