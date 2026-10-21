-- Creator program (kreatori): registration, Instagram DM verification, approval, personal code page
create table if not exists public.creators (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text,
  instagram text not null,                  -- handle, lowercase, no @
  city text,
  followers_claimed integer,
  niche text,
  note text,
  rules_accepted_at timestamptz not null,   -- ticked the rules when registering
  verify_code text not null unique,         -- CPS-1234, sent by DM from their own profile
  dm_verified_at timestamptz,
  dm_username text,                         -- the account the code DM came from
  status text not null default 'novi' check (status in ('novi','odobren','odbijen','klip_primljen','objavljen','pauza')),
  ref_code text unique,                     -- AMRA27, given on approval
  page_token uuid not null unique default gen_random_uuid(),
  committed_at timestamptz,                 -- confirmed the rules on their page: code becomes active
  ig_full_name text, ig_pic text, ig_followers integer, ig_following integer, ig_posts integer,
  ig_avg_likes numeric, ig_avg_comments numeric, ig_er numeric, ig_private boolean, ig_checked_at timestamptz, ig_error text,
  clip_url text,
  bonus_sent_at timestamptz,
  admin_note text
);
create unique index if not exists creators_instagram_key on public.creators (instagram);
create index if not exists creators_ref_lower on public.creators (lower(ref_code));
create index if not exists reservations_ref_lower on public.reservations (lower(referral_code));

alter table public.creators enable row level security;
drop policy if exists "admin reads creators" on public.creators;
drop policy if exists "admin updates creators" on public.creators;
drop policy if exists "admin deletes creators" on public.creators;
create policy "admin reads creators" on public.creators for select to authenticated using ((select public.is_admin()));
create policy "admin updates creators" on public.creators for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin deletes creators" on public.creators for delete to authenticated using ((select public.is_admin()));

drop trigger if exists creators_touch on public.creators;
create trigger creators_touch before update on public.creators for each row execute function public.touch_updated_at();

-- registration (anonymous). Returns the DM verification code.
create or replace function public.creator_register(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; c text; e text; existing public.creators; i int := 0;
begin
  if coalesce((p->>'rules')::boolean, false) is not true then return jsonb_build_object('ok', false, 'error', 'pravila'); end if;
  if coalesce(p->>'website', '') <> '' then return jsonb_build_object('ok', true, 'verify_code', 'CPS-0000'); end if; -- honeypot
  h := lower(regexp_replace(trim(coalesce(p->>'instagram', '')), '^(https?://)?(www\.)?(instagram\.com/)?@?', ''));
  h := regexp_replace(h, '[/?#].*$', '');
  e := lower(trim(coalesce(p->>'email', '')));
  if h !~ '^[a-z0-9._]{2,30}$' then return jsonb_build_object('ok', false, 'error', 'instagram'); end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'email'); end if;
  if length(trim(coalesce(p->>'full_name', ''))) < 2 then return jsonb_build_object('ok', false, 'error', 'ime'); end if;
  select * into existing from public.creators where instagram = h;
  if found then
    if lower(existing.email) = e then return jsonb_build_object('ok', true, 'verify_code', existing.verify_code, 'again', true); end if;
    return jsonb_build_object('ok', false, 'error', 'postoji');
  end if;
  loop
    c := 'CPS-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.creators where verify_code = c);
    i := i + 1; if i > 50 then raise exception 'no code'; end if;
  end loop;
  insert into public.creators (full_name, email, phone, instagram, city, followers_claimed, niche, note, rules_accepted_at, verify_code)
  values (left(trim(p->>'full_name'), 80), e, left(nullif(trim(p->>'phone'), ''), 30), h, left(nullif(trim(p->>'city'), ''), 60),
          nullif(regexp_replace(coalesce(p->>'followers', ''), '\D', '', 'g'), '')::int, left(nullif(trim(p->>'niche'), ''), 80),
          left(nullif(trim(p->>'note'), ''), 600), now(), c);
  return jsonb_build_object('ok', true, 'verify_code', c);
end; $$;
revoke all on function public.creator_register(jsonb) from public;
grant execute on function public.creator_register(jsonb) to anon, authenticated;

-- personal page: everything the creator may see, by their secret page token
create or replace function public.creator_page(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.creators; n int := 0; b int := 0;
begin
  select * into c from public.creators where page_token = p_token;
  if not found then return jsonb_build_object('ok', false); end if;
  if c.ref_code is not null and c.committed_at is not null then
    select count(*), coalesce(sum(quantity), 0) into n, b from public.reservations
     where lower(referral_code) = lower(c.ref_code) and status <> 'otkazana' and created_at >= c.committed_at;
  end if;
  return jsonb_build_object('ok', true, 'name', split_part(c.full_name, ' ', 1), 'instagram', c.instagram, 'status', c.status,
    'dm_verified', c.dm_verified_at is not null, 'verify_code', c.verify_code,
    'ref_code', case when c.status in ('odobren','klip_primljen','objavljen') and c.committed_at is not null then c.ref_code end,
    'committed', c.committed_at is not null, 'approved', c.status in ('odobren','klip_primljen','objavljen'),
    'reservations', n, 'bottles', b, 'goal', 10, 'bonus_sent', c.bonus_sent_at is not null);
end; $$;
revoke all on function public.creator_page(uuid) from public;
grant execute on function public.creator_page(uuid) to anon, authenticated;

-- the creator confirms the rules on their page; only then the code counts
create or replace function public.creator_commit(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.creators;
begin
  update public.creators set committed_at = now()
   where page_token = p_token and committed_at is null and status in ('odobren','klip_primljen','objavljen')
  returning * into c;
  if not found then return jsonb_build_object('ok', false); end if;
  perform public.enqueue_email('melvis@hadzic.com', 'admin_creator_committed', jsonb_build_object('name', c.full_name, 'instagram', c.instagram, 'ref_code', c.ref_code), 'cr_commit:' || c.id);
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.creator_commit(uuid) from public;
grant execute on function public.creator_commit(uuid) to anon, authenticated;

-- ref code from the first name: AMRA27
create or replace function public.creator_make_code(p_name text)
returns text language plpgsql volatile set search_path = '' as $$
declare base text; c text; i int := 0;
begin
  base := upper(translate(split_part(trim(p_name), ' ', 1), 'čćžšđČĆŽŠĐáàäéèëíïóöúüÁÉÍÓÚ', 'cczsdCCZSDaaaeeeiioouuAEIOU'));
  base := left(regexp_replace(base, '[^A-Z]', '', 'g'), 8);
  if length(base) < 2 then base := 'KREATOR'; end if;
  loop
    c := base || lpad((floor(random() * 90) + 10)::int::text, 2, '0');
    exit when not exists (select 1 from public.creators where lower(ref_code) = lower(c))
          and not exists (select 1 from public.reservations where lower(referral_code) = lower(c));
    i := i + 1; if i > 80 then c := base || (floor(random() * 9000) + 1000)::int::text; exit; end if;
  end loop;
  return c;
end; $$;

-- emails + code on approval
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
    elsif new.status = 'odbijen' then
      perform public.enqueue_email(new.email, 'creator_rejected', jsonb_build_object('name', new.full_name), 'cr_no:' || new.id);
    end if;
  end if;
  return new;
end; $$;

create or replace function public.creator_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('odobren','klip_primljen','objavljen') and new.ref_code is null then
    new.ref_code := public.creator_make_code(new.full_name);
  end if;
  return new;
end; $$;

drop trigger if exists creators_code on public.creators;
create trigger creators_code before insert or update of status on public.creators for each row execute function public.creator_before();
drop trigger if exists mail_on_creator on public.creators;
create trigger mail_on_creator after insert or update of status on public.creators for each row execute function public.mail_on_creator();

-- a DM to the brand account containing CPS-1234 verifies that creator
create or replace function public.creator_dm_verify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m text;
begin
  if new.kind = 'dm' and coalesce(new.direction, 'in') = 'in' and new.text is not null then
    m := upper(substring(new.text from '(?i)CPS[\s-]?\d{4}'));
    if m is not null then
      m := 'CPS-' || right(regexp_replace(m, '\D', '', 'g'), 4);
      update public.creators set dm_verified_at = coalesce(dm_verified_at, now()), dm_username = coalesce(new.username, dm_username)
       where verify_code = m and (new.username is null or lower(new.username) = instagram);
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists creator_dm_verify on public.ig_messages;
create trigger creator_dm_verify after insert on public.ig_messages for each row execute function public.creator_dm_verify();

-- admin overview with live reservation counts per code
create or replace view public.admin_creators with (security_invoker = true) as
select c.*,
  (select count(*) from public.reservations r where c.ref_code is not null and lower(r.referral_code) = lower(c.ref_code) and r.status <> 'otkazana') as reservations,
  (select coalesce(sum(r.quantity), 0) from public.reservations r where c.ref_code is not null and lower(r.referral_code) = lower(c.ref_code) and r.status <> 'otkazana') as bottles
from public.creators c;
revoke all on public.admin_creators from anon;
grant select on public.admin_creators to authenticated;
