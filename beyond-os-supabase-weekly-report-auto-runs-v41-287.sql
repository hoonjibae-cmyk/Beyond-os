-- Beyond OS v41-287: 위클리 리포트 자동 생성·발송 실행 기록
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 무엇에 쓰나
--   위클리 리포트 탭의 [자동 발송 설정]에서 요일·시각을 정해 두면, 그 시각에 서버가
--   지정한 주(월~일)의 리포트를 자동 구성하고 아직 발송하지 않은 학생에게 알림톡을 보냅니다.
--   이 표는 "어느 주를 언제 처리했고 결과가 어땠는지"를 남겨, 같은 주를 두 번 처리하지 않게 하고
--   화면에 최근 실행 결과를 보여 줍니다. 설정 자체는 system_settings(report_send_settings)에 저장됩니다.

create table if not exists weekly_report_auto_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  trigger text not null default 'auto',
  week_start date not null,
  week_end date not null,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  compose_summary jsonb,
  send_summary jsonb,
  settings_snapshot jsonb,
  last_error text,
  attempts integer not null default 1,
  triggered_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists weekly_report_auto_runs_key_uidx on weekly_report_auto_runs (run_key);
create index if not exists weekly_report_auto_runs_week_idx on weekly_report_auto_runs (week_start desc, started_at desc);

comment on table weekly_report_auto_runs is '위클리 리포트 자동 생성·발송 실행 기록 (v41-287)';
comment on column weekly_report_auto_runs.run_key is 'auto:주시작~주끝 (자동, 주당 1회) · manual:주시작~주끝:시각 (화면 [지금 실행])';
