-- Route Network Database schema.
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query),
-- once, before anything else. No API key needed -- this runs under your own
-- dashboard login with full owner privileges.

-- ---------- airlines ----------
-- The operating carrier a batch of routes belongs to, picked once at import
-- time (not a spreadsheet column). PRVA's own routes import under the row
-- with is_mainline = true; a future codeshare partner (e.g. STARLUX) gets
-- its own row here, and the UI shows a codeshare badge automatically for
-- any route whose airline isn't the mainline one.
create table airlines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  logo_url text,
  is_mainline boolean not null default false,
  created_at timestamptz not null default now()
);

-- Only one airline may be marked mainline.
create unique index one_mainline_airline on airlines (is_mainline) where is_mainline;

-- ---------- airports ----------
-- Seeded from OurAirports' public dataset (002_airports_seed.sql), not
-- parsed from the route spreadsheet -- the sheet's city-name text isn't
-- reliable enough (e.g. "Los Angeles Intl." has no city prefix).
create table airports (
  icao text primary key,
  iata text,
  name text not null,
  city text,
  country text,
  lat double precision,
  lon double precision
);

-- ---------- routes ----------
create table routes (
  id uuid primary key default gen_random_uuid(),
  flight_number text not null,
  origin_icao text not null references airports(icao),
  destination_icao text not null references airports(icao),
  aircraft_types text[] not null default '{}',
  liveries text[] not null default '{}',
  flight_time_minutes integer,
  distance_nm numeric,
  airline_id uuid not null references airlines(id),
  category text not null default 'current' check (category in ('current', 'historic')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index routes_origin_idx on routes(origin_icao);
create index routes_destination_idx on routes(destination_icao);
create index routes_airline_idx on routes(airline_id);
create index routes_category_idx on routes(category);

-- ---------- Row Level Security ----------
-- Public (anon key) can read everything. Only authenticated users can
-- write -- staff accounts are created manually in Supabase Auth with no
-- public signup, so "authenticated" and "staff" are the same set of people
-- by construction; no separate role/claim needed.
alter table airlines enable row level security;
alter table airports enable row level security;
alter table routes enable row level security;

create policy "public read airlines" on airlines for select using (true);
create policy "public read airports" on airports for select using (true);
create policy "public read routes" on routes for select using (true);

create policy "staff write airlines" on airlines for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff write airports" on airports for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff write routes" on routes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- Storage: airline tail logos ----------
insert into storage.buckets (id, name, public)
values ('airline-logos', 'airline-logos', true);

create policy "public read airline logos" on storage.objects for select
  using (bucket_id = 'airline-logos');
create policy "staff upload airline logos" on storage.objects for insert
  with check (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
create policy "staff update airline logos" on storage.objects for update
  using (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
create policy "staff delete airline logos" on storage.objects for delete
  using (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
