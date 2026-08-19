-- The original "Generate Roster for This Month" used a single
-- career_schedules.in_career_mode flag with no month boundary -- once a
-- route was flagged, it showed on every month's calendar forever,
-- including months nobody had generated a roster for yet (confirmed live:
-- navigating forward to a future month still showed the current roster).
-- Replaced with a proper per-month join table: a row here means that
-- schedule is in the Career Mode roster for that specific year-month.
-- A month with no rows just renders blank, as intended.
create table career_mode_roster (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references career_schedules(id) on delete cascade,
  year_month text not null, -- 'YYYY-MM'
  created_at timestamptz not null default now(),
  unique (schedule_id, year_month)
);

create index career_mode_roster_month_idx on career_mode_roster(year_month);

alter table career_mode_roster enable row level security;
create policy "public read career_mode_roster" on career_mode_roster for select using (true);
create policy "staff write career_mode_roster" on career_mode_roster for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Carry forward whatever's currently flagged so this month's existing
-- roster isn't lost, then drop the superseded flag.
insert into career_mode_roster (schedule_id, year_month)
select id, to_char(now(), 'YYYY-MM') from career_schedules where in_career_mode = true;

alter table career_schedules drop column in_career_mode;
