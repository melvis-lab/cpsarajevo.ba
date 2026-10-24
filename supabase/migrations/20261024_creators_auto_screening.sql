-- 24 Oct 2026: screening columns + call creator-screen when an applicant confirms (applied via MCP as creators_auto_screening)
alter table public.creators add column if not exists screen_score int, add column if not exists screen_fit text,
  add column if not exists screen_reason text, add column if not exists screened_at timestamptz;
-- see creator_request_screen(), mail_on_creator() and admin_creators in the live database
