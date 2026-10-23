-- NOT APPLIED YET (cancelled 22 Oct 2026): run only after Melvis approves the stock/costs section.
-- Nabavka i zalihe: purchasing NL -> Sarajevo, landed cost, stock, sales, forecast.
-- Admin only (public.is_admin()). Amounts: EUR or KM, fixed rate 1 EUR = 1.95583 KM.

-- Articles (12 x 50 ml from products, plus anything else: travel size, home spray, testers)
create table if not exists public.inv_items (
  sku text primary key,
  product_slug text references public.products(slug) on update cascade,
  name text not null,
  size_ml integer,
  buy_eur numeric(10,2) not null default 15,      -- purchase price per unit in NL
  retail_km numeric(10,2),                         -- retail price incl. PDV
  b2b_km numeric(10,2),                            -- reseller price incl. PDV
  pack_size integer not null default 1,            -- order in multiples of
  min_stock integer not null default 0,            -- never go below
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now()
);

-- One purchase = one shipment from the Netherlands
create table if not exists public.inv_shipments (
  id uuid primary key default gen_random_uuid(),
  ref text not null,                               -- e.g. NAB-2026-01
  supplier text not null default 'Collection Premium Paris (NL)',
  status text not null default 'planirano'
    check (status in ('planirano','naruceno','placeno','spremno','u_tranzitu','na_carini','primljeno','otkazano')),
  transport text not null default 'vlastito_vozilo'
    check (transport in ('vlastito_vozilo','kurir','spedicija','kombi_prevoz','posta')),
  carrier text,
  tracking_no text,
  tracking_url text,
  eu_origin boolean not null default true,         -- EUR.1 / izjava o porijeklu na fakturi -> carina 0%
  duty_rate numeric(5,2),                          -- null = from settings
  supplier_invoice text,
  jci_no text,                                     -- broj JCI (carinska deklaracija)
  order_date date,
  paid_date date,
  ship_date date,
  expected_date date,
  received_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inv_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inv_shipments(id) on delete cascade,
  sku text not null references public.inv_items(sku) on update cascade,
  qty_ordered integer not null default 0 check (qty_ordered >= 0),
  qty_received integer check (qty_received >= 0),  -- null until counted
  qty_damaged integer not null default 0 check (qty_damaged >= 0),
  unit_eur numeric(10,2) not null default 15,
  unique (shipment_id, sku)
);

-- Track & trace timeline
create table if not exists public.inv_tracking (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inv_shipments(id) on delete cascade,
  at timestamptz not null default now(),
  status text,
  location text,
  note text
);

-- Every cost: per shipment (landed cost) or general (overhead)
create table if not exists public.inv_costs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.inv_shipments(id) on delete cascade,
  at date not null default current_date,
  category text not null check (category in (
    'roba','transport','gorivo','putarina','smjestaj','spedicija_nl','spedicija_ba','carina','pdv_uvoz',
    'sanitarna','terminal','osiguranje','banka','etikete','ambalaza','skladiste','marketing','ostalo')),
  description text,
  amount numeric(12,2) not null,
  currency text not null default 'KM' check (currency in ('KM','EUR')),
  in_landed_cost boolean not null default true,     -- spread over bottles of this shipment
  is_estimate boolean not null default false,       -- procjena dok ne stigne račun
  created_at timestamptz not null default now()
);

-- Sales (one row per article; several rows can share order_ref)
create table if not exists public.inv_sales (
  id uuid primary key default gen_random_uuid(),
  at date not null default current_date,
  sku text not null references public.inv_items(sku) on update cascade,
  qty integer not null check (qty > 0),
  unit_km numeric(10,2) not null,                   -- price paid incl. PDV
  channel text not null default 'web'
    check (channel in ('web','instagram','whatsapp','b2b','preprodavac','kreator','licno','ostalo')),
  customer text,
  order_ref text,
  reservation_id uuid unique references public.reservations(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- Stock moves that are not a sale or a receipt: gifts, testers, damage, corrections, returns
create table if not exists public.inv_moves (
  id uuid primary key default gen_random_uuid(),
  at date not null default current_date,
  sku text not null references public.inv_items(sku) on update cascade,
  qty integer not null,                             -- + in, - out
  kind text not null check (kind in ('poklon','tester','kreator','kvar','korekcija','povrat','inventura')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.inv_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- RLS: owner only
do $$ declare t text; begin
  foreach t in array array['inv_items','inv_shipments','inv_shipment_lines','inv_tracking','inv_costs','inv_sales','inv_moves','inv_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin all %1$s" on public.%1$I', t);
    execute format('create policy "admin all %1$s" on public.%1$I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

create index if not exists inv_lines_ship on public.inv_shipment_lines(shipment_id);
create index if not exists inv_lines_sku on public.inv_shipment_lines(sku);
create index if not exists inv_track_ship on public.inv_tracking(shipment_id, at desc);
create index if not exists inv_costs_ship on public.inv_costs(shipment_id);
create index if not exists inv_sales_sku_at on public.inv_sales(sku, at);
create index if not exists inv_moves_sku on public.inv_moves(sku);

-- Stock per article: received (counted, minus damaged) + moves - sales; plus what is on the way
create or replace view public.inv_stock with (security_invoker = true) as
select i.sku, i.name, i.product_slug, i.size_ml, i.buy_eur, i.retail_km, i.b2b_km, i.pack_size, i.min_stock, i.active, i.sort,
  coalesce(r.received, 0) as received,
  coalesce(m.moved, 0) as moved,
  coalesce(s.sold, 0) as sold,
  coalesce(r.received, 0) + coalesce(m.moved, 0) - coalesce(s.sold, 0) as on_hand,
  coalesce(t.in_transit, 0) as in_transit,
  coalesce(s.sold_30, 0) as sold_30,
  coalesce(s.sold_90, 0) as sold_90,
  coalesce(v.reserved, 0) as reserved_open
from public.inv_items i
left join (select l.sku, sum(coalesce(l.qty_received, l.qty_ordered) - l.qty_damaged) received
           from public.inv_shipment_lines l join public.inv_shipments sh on sh.id = l.shipment_id
           where sh.status = 'primljeno' group by l.sku) r on r.sku = i.sku
left join (select sku, sum(qty) moved from public.inv_moves group by sku) m on m.sku = i.sku
left join (select sku, sum(qty) sold,
                  sum(qty) filter (where at > current_date - 30) sold_30,
                  sum(qty) filter (where at > current_date - 90) sold_90
           from public.inv_sales group by sku) s on s.sku = i.sku
left join (select l.sku, sum(l.qty_ordered) in_transit
           from public.inv_shipment_lines l join public.inv_shipments sh on sh.id = l.shipment_id
           where sh.status in ('naruceno','placeno','spremno','u_tranzitu','na_carini') group by l.sku) t on t.sku = i.sku
left join (select x.product_slug, sum(x.quantity) reserved
           from public.reservations x
           where x.status in ('nova','kontaktirana','potvrdjena') group by x.product_slug) v
       on v.product_slug = i.product_slug and i.sku = i.product_slug || '-50';

-- Sales per article per month (for the forecast)
create or replace view public.inv_sales_monthly with (security_invoker = true) as
select sku, date_trunc('month', at)::date as month, sum(qty) qty, sum(qty * unit_km) revenue_km
from public.inv_sales group by 1, 2;

-- Seed: 12 scents x 50 ml at 15 EUR
insert into public.inv_items (sku, product_slug, name, size_ml, buy_eur, sort)
select p.slug || '-50', p.slug, p.name || ' 50 ml', 50, 15, p.sort
from public.products p
on conflict (sku) do nothing;

insert into public.inv_settings (key, value) values
  ('kurs', '1.95583'),
  ('pdv', '17'),
  ('pdv_obveznik', 'da'),
  ('carina_eu', '0'),
  ('carina_bez_porijekla', '15'),
  ('dani_isporuke', '14'),
  ('sigurnosna_zaliha_dana', '21'),
  ('pokrivenost_dana', '45'),
  ('plan_mjesecno', '150'),
  ('sezona', '{"1":1.6,"2":1.1,"3":1.3,"4":0.9,"5":1.1,"6":0.9,"7":0.8,"8":0.8,"9":0.9,"10":1.0,"11":1.2,"12":1.8}'),
  ('marza_cilj', '60'),
  ('trosak_km_vozilo', '0.45'),
  ('pokretanje', '2027-01-01')
on conflict (key) do nothing;
