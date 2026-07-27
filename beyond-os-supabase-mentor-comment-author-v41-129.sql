-- ─────────────────────────────────────────────────────────────
-- Beyond OS v41-129
-- 학습멘토 코멘트 작성자 표시용 컬럼 추가
--
-- 메인 대시보드 우측 '학습멘토 코멘트'에 어떤 멘토가 작성했는지 표시하기 위해
-- daily_reports 에 작성자/작성시각 컬럼을 추가합니다.
--
-- 기존 created_by 는 리포트 생성·발송 등 다른 작업에서도 갱신되기 때문에
-- '코멘트를 쓴 사람'을 정확히 나타내지 못해 전용 컬럼을 둡니다.
--
-- 이 SQL을 실행하기 전에도 앱은 정상 동작합니다.
-- (컬럼이 없으면 작성자 저장을 건너뛰고, 화면에는 기존 created_by 를 대신 표시)
-- ─────────────────────────────────────────────────────────────

alter table public.daily_reports
  add column if not exists mentor_comment_by text;

alter table public.daily_reports
  add column if not exists mentor_comment_at timestamptz;

comment on column public.daily_reports.mentor_comment_by is '학습멘토 코멘트를 마지막으로 저장한 사용자 표시명';
comment on column public.daily_reports.mentor_comment_at is '학습멘토 코멘트를 마지막으로 저장한 시각';
