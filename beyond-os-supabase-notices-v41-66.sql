-- Beyond OS v41-66: 스터디카페 공지사항 (알림톡 일괄 발송)
-- Supabase SQL Editor에서 1회 실행하세요. (기존 스키마 실행 후 추가)
-- 공지사항을 작성/보관하고, 학부모 전체에게 카카오 알림톡(공지 템플릿)으로 링크를 발송합니다.

create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,                       -- 인앱 작성 본문(외부 URL 사용 시 비어있을 수 있음)
  external_url text,               -- 외부 웹링크(있으면 이 링크로 발송, 없으면 /n/{token})
  token text unique,               -- 공개 공지 페이지(/n/{token}) 토큰
  status text not null default 'draft',   -- draft | sent
  sent_at timestamptz,
  sent_count integer default 0,
  last_send_summary jsonb,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_notices_created on notices(created_at desc);

-- updated_at 자동 갱신 (set_updated_at 함수는 기존 스키마에서 생성됨)
drop trigger if exists trg_notices_updated_at on notices;
create trigger trg_notices_updated_at
  before update on notices
  for each row execute function set_updated_at();
