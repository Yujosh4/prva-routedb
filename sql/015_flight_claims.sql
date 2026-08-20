-- Crew Center Phase 3: claiming. A flight_claims row turns "this route
-- runs today" (career_schedules, a recurring pattern) into "a specific
-- pilot is flying this specific calendar occurrence of it" -- claiming
-- PR102's Monday/Wednesday/Friday pattern doesn't claim every future
-- Monday/Wednesday/Friday, just the one date being claimed.
--
-- Outbound and return legs are separate career_schedules rows (separate
-- flight numbers) with no link between them here on purpose -- claiming
-- one has no effect on the other's availability. Confirmed with Martin;
-- auto-pairing them is a deliberately separate, later phase.
create table flight_claims (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid not null references pilots(id) on delete cascade,
  schedule_id uuid not null references career_schedules(id),
  flight_date date not null,
  status text not null default 'claimed' check (status in ('claimed', 'flown', 'expired')),
  claimed_at timestamptz not null default now()
);

create index flight_claims_pilot_idx on flight_claims(pilot_id);
-- One pilot per flight per day: a partial unique index rather than a
-- table constraint, so an expired claim doesn't permanently block that
-- flight/date from ever being claimed again -- only non-expired claims
-- compete for the slot.
create unique index flight_claims_one_active_per_flight
  on flight_claims(schedule_id, flight_date) where status != 'expired';

alter table flight_claims enable row level security;
-- Public read: the claim UI needs to show "already claimed by so-and-so"
-- to pilots who don't own that claim, and the unique index above is what
-- actually enforces exclusivity -- this policy is just visibility.
create policy "public read flight_claims" on flight_claims for select using (true);
create policy "pilot insert own claim" on flight_claims for insert
  with check (auth.uid() = pilot_id);
create policy "pilot or staff update claim" on flight_claims for update
  using (auth.uid() = pilot_id or is_staff())
  with check (auth.uid() = pilot_id or is_staff());
create policy "pilot or staff delete claim" on flight_claims for delete
  using (auth.uid() = pilot_id or is_staff());
