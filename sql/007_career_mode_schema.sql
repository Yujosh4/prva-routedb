-- Career Mode data model, Phase 1: schedule structure only. Deliberately
-- does NOT yet include a pilot-assignment table ("which pilot claimed this
-- flight") -- that needs a real pilots table, which only exists once Crew
-- Center ships. This phase makes the schedule itself real and queryable
-- now; assignment tracking is a follow-up once pilot accounts exist.

-- ---------- ranks ----------
-- Mirrors the real rank list already on the marketing site
-- (Website/data/ranks.json) verbatim, not invented -- min_hours is parsed
-- from each rank's hour requirement where it has one (the first two ranks
-- are onboarding-based, not hour-based, hence nullable).
create table ranks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null unique,
  min_hours numeric,
  requirement_text text not null
);

insert into ranks (name, sort_order, min_hours, requirement_text) values
  ('In Academy', 0, null, 'Given to every pilot entering the Academy'),
  ('Cadet', 1, null, 'Given upon completion of the Academy'),
  ('Second Officer', 2, 25, '25 Hours'),
  ('First Officer', 3, 50, '50 Hours'),
  ('Senior First Officer', 4, 100, '100 Hours'),
  ('Captain', 5, 250, '250 Hours'),
  ('Senior Captain', 6, 300, '300 Hours'),
  ('Commander', 7, 400, '400 Hours'),
  ('MM Classic', 8, 500, '500 Hours'),
  ('MM Elite', 9, 1000, '1,000 Hours'),
  ('MM Premier Elite', 10, 2500, '2,500 Hours'),
  ('MM Million Miler', 11, 5000, '5,000 Hours');

alter table ranks enable row level security;
create policy "public read ranks" on ranks for select using (true);
create policy "staff write ranks" on ranks for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- career_schedules ----------
-- One row per scheduled flight *pattern* (e.g. "PR102, departs 10:15 local
-- Mon/Wed/Fri") -- not one row per calendar occurrence. Reuses the existing
-- routes/airlines tables rather than duplicating route data.
create table career_schedules (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes(id),
  airline_id uuid not null references airlines(id),
  departure_time_local time not null,
  -- ISO day-of-week numbers, 1=Monday .. 7=Sunday, e.g. '{1,3,5}' for Mon/Wed/Fri.
  days_of_week integer[] not null,
  min_rank_id uuid references ranks(id),
  active boolean not null default true,
  -- Provenance matters here specifically because the schedule data source
  -- (real-world API vs synthesized) was still being decided as of writing
  -- this -- lets staff (and future us) tell at a glance which rows are
  -- grounded in a real timetable vs generated.
  source text not null default 'manual' check (source in ('real_world_api', 'manual', 'derived')),
  notes text,
  created_at timestamptz not null default now()
);

create index career_schedules_route_idx on career_schedules(route_id);
create index career_schedules_airline_idx on career_schedules(airline_id);

alter table career_schedules enable row level security;
create policy "public read career_schedules" on career_schedules for select using (true);
create policy "staff write career_schedules" on career_schedules for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
