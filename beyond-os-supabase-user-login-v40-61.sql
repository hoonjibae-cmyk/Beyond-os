-- Beyond OS v40-61: 개인 계정 로그인 전환
-- Supabase SQL Editor에서 1회 실행하세요.
-- 목적:
-- 1) app_users에 비밀번호 해시/솔트/로그인 상태 컬럼 추가
-- 2) 승인된 유저가 개인 아이디/비밀번호로 로그인할 수 있는 기반 마련
-- 3) 기존 ADMIN_PASSWORD 로그인은 비상용 관리자 접속으로 유지

alter table app_users add column if not exists password_hash text;
alter table app_users add column if not exists password_salt text;
alter table app_users add column if not exists password_set_at timestamptz;
alter table app_users add column if not exists require_password_change boolean not null default false;
alter table app_users add column if not exists login_failed_count integer not null default 0;
alter table app_users add column if not exists locked_until timestamptz;

create index if not exists idx_app_users_password_set
on app_users(password_set_at);

create index if not exists idx_app_users_last_login_at
on app_users(last_login_at desc);

-- 기존 owner 계정은 비밀번호가 별도로 설정되기 전까지는 ADMIN_PASSWORD 비상 로그인으로 관리합니다.
-- 유저 관리 탭에서 owner 또는 각 유저에게 임시 비밀번호를 설정한 뒤 개인 계정 로그인을 사용할 수 있습니다.
