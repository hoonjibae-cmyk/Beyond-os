-- Beyond OS v40-59: 계정/권한 관리 기반 구축
-- Supabase SQL Editor에서 1회 실행하세요.
-- 목적:
-- 1) 공용 ADMIN_PASSWORD 로그인에서 개인 계정 로그인으로 전환하기 위한 기반 테이블 생성
-- 2) 총괄관리자/일반유저 역할과 페이지별 권한 저장
-- 3) 계정 생성 승인/거절/비활성 관리 준비
-- 4) 리포트 발송자/주요 작업자 로그를 남길 user_action_logs 기반 생성
-- 참고: v40-59에서는 기존 공용 관리자 비밀번호 로그인을 비상용으로 유지합니다.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  username text not null unique,
  display_name text not null,
  email text,
  phone text,
  role text not null default 'user',
  status text not null default 'pending',
  permissions jsonb not null default '{}'::jsonb,
  privacy_agreed_at timestamptz,
  terms_agreed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  last_login_at timestamptz,
  password_reset_requested_at timestamptz,
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table app_users add column if not exists auth_user_id uuid;
alter table app_users add column if not exists username text;
alter table app_users add column if not exists display_name text;
alter table app_users add column if not exists email text;
alter table app_users add column if not exists phone text;
alter table app_users add column if not exists role text not null default 'user';
alter table app_users add column if not exists status text not null default 'pending';
alter table app_users add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table app_users add column if not exists privacy_agreed_at timestamptz;
alter table app_users add column if not exists terms_agreed_at timestamptz;
alter table app_users add column if not exists approved_by text;
alter table app_users add column if not exists approved_at timestamptz;
alter table app_users add column if not exists last_login_at timestamptz;
alter table app_users add column if not exists password_reset_requested_at timestamptz;
alter table app_users add column if not exists memo text;
alter table app_users add column if not exists created_at timestamptz default now();
alter table app_users add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_app_users_username
on app_users(lower(username));

create index if not exists idx_app_users_role
on app_users(role);

create index if not exists idx_app_users_status
on app_users(status);

drop trigger if exists set_timestamp_app_users on app_users;
create trigger set_timestamp_app_users
before update on app_users
for each row execute function public.set_updated_at();

create table if not exists user_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  actor_name text,
  action_type text not null,
  target_type text,
  target_id text,
  target_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table user_action_logs add column if not exists user_id uuid references app_users(id) on delete set null;
alter table user_action_logs add column if not exists actor_name text;
alter table user_action_logs add column if not exists action_type text;
alter table user_action_logs add column if not exists target_type text;
alter table user_action_logs add column if not exists target_id text;
alter table user_action_logs add column if not exists target_name text;
alter table user_action_logs add column if not exists payload jsonb not null default '{}'::jsonb;
alter table user_action_logs add column if not exists created_at timestamptz default now();

create index if not exists idx_user_action_logs_user_id
on user_action_logs(user_id);

create index if not exists idx_user_action_logs_action_type
on user_action_logs(action_type);

create index if not exists idx_user_action_logs_created_at
on user_action_logs(created_at desc);

-- 최초 기준 계정. 실제 개인 로그인 전환 전까지는 공용 관리자 비밀번호가 계속 유효합니다.
insert into app_users (
  username,
  display_name,
  email,
  phone,
  role,
  status,
  permissions,
  terms_agreed_at,
  privacy_agreed_at,
  approved_by,
  approved_at,
  memo
)
values (
  'owner',
  '총괄관리자',
  null,
  null,
  'super_admin',
  'active',
  '{
    "dashboard": true,
    "schedules": true,
    "planner": true,
    "dailyReports": true,
    "weeklyReports": true,
    "ranking": true,
    "attendance": true,
    "attention": true,
    "settings": true,
    "userManagement": true
  }'::jsonb,
  now(),
  now(),
  'system',
  now(),
  'v40-59 초기 총괄관리자 기준 계정'
)
on conflict (username) do nothing;
