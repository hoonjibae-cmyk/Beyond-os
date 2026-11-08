-- Beyond OS v41-286: 개인 계정 자동 로그인(로그인 상태 유지) 토큰
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 무엇에 쓰나
--   개인 계정 로그인 때 [이 기기에서 로그인 상태 유지]를 켜면 기기마다 자동 로그인 토큰을 만들어
--   여기 해시로 저장합니다. 앱을 다시 열 때 이 토큰으로 계정 상태를 확인하고 새 로그인 토큰을 받습니다.
--   비밀번호는 저장하지 않습니다. 계정이 비활성화·삭제되거나 임시 비밀번호가 설정되면
--   그 사용자의 토큰은 모두 폐기(revoked_at)되어 어느 기기에서도 자동 로그인이 되지 않습니다.
--   이 표가 없어도 일반 로그인은 그대로 동작하며, 자동 로그인만 저장되지 않습니다.

create table if not exists app_user_remember_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null,
  device_label text,
  client_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);

create unique index if not exists app_user_remember_tokens_hash_uidx on app_user_remember_tokens (token_hash);
create index if not exists app_user_remember_tokens_user_idx on app_user_remember_tokens (user_id, revoked_at);

comment on table app_user_remember_tokens is '개인 계정 자동 로그인 토큰(해시) · 기기별 (v41-286)';
comment on column app_user_remember_tokens.revoked_reason is 'logout = 사용자가 로그아웃 · inactive = 계정 비활성화 · deleted = 계정 삭제 · password_reset = 임시 비밀번호 설정';
