-- Beyond OS v41-70: 공지 알림톡 목적별(카테고리) 템플릿 지원
-- Supabase SQL Editor에서 1회 실행하세요. (beyond-os-supabase-notices-v41-66.sql 실행 후 추가)
-- 공지에 카테고리(운영규정/운영시간변동/환불규정 등)와, 필드형 템플릿의 항목값을 저장합니다.

alter table notices add column if not exists category text not null default 'operating_rules';
-- 필드형 템플릿(예: 운영시간 변동 안내)의 항목값 { period, reason, detail } 저장
alter table notices add column if not exists template_data jsonb;
