-- Creators: quiet declines and 30-day cleanup (24 Oct 2026)
-- 1. "Odbij" emails the applicant only when their DM is confirmed, i.e. we know the email
--    and the Instagram profile belong to the same person. Unconfirmed (often fake) sign-ups
--    are declined silently, so a prank never reaches a stranger's inbox.
-- 2. rejected_at records when a creator was declined; a daily job deletes declined
--    applications 30 days later, together with the queued/sent emails that carry their address.

alter table public.creators add column if not exists rejected_at timestamptz;
update public.creators set rejected_at = coalesce(rejected_at, updated_at) where status = 'odbijen';

create or replace function public.creator_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('odobren','klip_primljen','objavljen') and new.ref_code is null then
    new.ref_code := public.creator_make_code(new.full_name);
  end if;
  if new.status = 'odbijen' then
    new.rejected_at := coalesce(new.rejected_at, now());
  else
    new.rejected_at := null;
  end if;
  return new;
end; $$;

create or replace function public.mail_on_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_email('melvis@hadzic.com', 'admin_new_creator', jsonb_build_object('name', new.full_name, 'email', new.email, 'phone', new.phone,
      'instagram', new.instagram, 'city', new.city, 'followers', new.followers_claimed, 'niche', new.niche, 'note', new.note, 'verify_code', new.verify_code), 'cr_new:' || new.id);
    perform public.enqueue_email(new.email, 'creator_received', jsonb_build_object('name', new.full_name, 'instagram', new.instagram, 'verify_code', new.verify_code,
      'token', new.page_token), 'cr_recv:' || new.id);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'odobren' and old.status in ('novi','odbijen','pauza') then
      perform public.enqueue_email(new.email, 'creator_approved', jsonb_build_object('name', new.full_name, 'token', new.page_token), 'cr_ok:' || new.id);
    elsif new.status = 'odbijen' and new.dm_verified_at is not null then
      perform public.enqueue_email(new.email, 'creator_rejected', jsonb_build_object('name', new.full_name), 'cr_no:' || new.id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.purge_declined_creators()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with gone as (
    delete from public.creators where status = 'odbijen' and rejected_at < now() - interval '30 days' returning id
  ), mails as (
    delete from public.email_outbox o using gone
     where o.dedupe_key in ('cr_new:' || gone.id, 'cr_recv:' || gone.id, 'cr_no:' || gone.id, 'cr_ok:' || gone.id)
  )
  select count(*) into n from gone;
  return n;
end; $$;
revoke all on function public.purge_declined_creators() from public, anon, authenticated;

select cron.unschedule('purge-declined-creators') where exists (select 1 from cron.job where jobname = 'purge-declined-creators');
select cron.schedule('purge-declined-creators', '30 3 * * *', 'select public.purge_declined_creators()');

-- the admin view lists c.*, so rebuild it to include rejected_at
drop view if exists public.admin_creators;
create view public.admin_creators with (security_invoker = true) as
select c.*,
  (select count(*) from public.reservations r where c.ref_code is not null and lower(r.referral_code) = lower(c.ref_code) and r.status <> 'otkazana') as reservations,
  (select coalesce(sum(r.quantity), 0) from public.reservations r where c.ref_code is not null and lower(r.referral_code) = lower(c.ref_code) and r.status <> 'otkazana') as bottles
from public.creators c;
revoke all on public.admin_creators from anon;
grant select on public.admin_creators to authenticated;
