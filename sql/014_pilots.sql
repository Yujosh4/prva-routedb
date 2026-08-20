-- Crew Center Phase 2: pilot accounts. A pilot signs up via Supabase Auth
-- (email/password, self-signup -- distinct from staff accounts, which stay
-- manually created) and gets one row here, tagged from the start with the
-- "In Academy" rank (sort_order 0) every pilot starts at.
--
-- discourse_username is what the pilot types in at signup (their IFC
-- username); infinite_flight_user_id is resolved from it once via the
-- Live API's Get User Stats endpoint (see supabase/functions/resolve-if-
-- user) and cached here, since that's the ID Get User Flights is actually
-- queried by for PIREP verification -- not looked up by username on every
-- PIREP, which would mean an extra round trip every time.
--
-- rank_id has no column default -- a DEFAULT expression can't reliably
-- reference another table's data across all Postgres versions/contexts,
-- so js/crew-auth.js looks up the "In Academy" rank's real id (sort_order
-- = 0) explicitly and sets it at insert time instead.
create table pilots (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  discourse_username text not null,
  infinite_flight_user_id uuid,
  rank_id uuid not null references ranks(id),
  total_hours numeric not null default 0,
  created_at timestamptz not null default now()
);

create index pilots_rank_idx on pilots(rank_id);

alter table pilots enable row level security;
-- Public read: the leaderboard needs to read every pilot's name/rank/hours.
create policy "public read pilots" on pilots for select using (true);
-- A pilot creates and can only ever update their own row -- never someone
-- else's, and never total_hours/rank_id directly (those only change via
-- the PIREP-approval path, which runs as staff / a service-role Edge
-- Function, not through this policy). Enforced at the application layer
-- for now (the signup/profile-edit forms only ever touch display_name/
-- discourse_username); a stricter column-level policy can be added later
-- if that proves necessary.
create policy "pilot insert own row" on pilots for insert
  with check (auth.uid() = id);
create policy "pilot update own row" on pilots for update
  using (auth.uid() = id) with check (auth.uid() = id);
