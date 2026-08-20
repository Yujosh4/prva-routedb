-- Crew Center Phase 4: PIREPs and logbook verification. One row per
-- filed PIREP against a claim -- claim_id links back to exactly which
-- flight_claims row (and therefore which schedule + date) this PIREP is
-- reporting on.
--
-- Multiplier values are self-reported at submission time for shop/event
-- (no purchase-tracking or event-management system exists yet -- staff
-- verifies legitimacy manually via the required remarks, which is already
-- the design: any non-"none" multiplier always needs individual staff
-- review regardless of verification_status). ROTW is fixed at 1.5x;
-- tier_perk is derived from the pilot's own rank at submission time, not
-- chosen by the pilot.
create table pireps (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references flight_claims(id),
  pilot_id uuid not null references pilots(id),
  simbrief_ofp_id text,
  if_logbook_flight_id text,
  logged_flight_minutes numeric,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'unverified')),
  multiplier_type text not null default 'none' check (multiplier_type in ('none', 'rotw', 'event', 'shop', 'tier_perk')),
  multiplier_value numeric not null default 1.0,
  remarks text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  hours_awarded numeric,
  created_at timestamptz not null default now(),
  constraint pireps_remarks_required_for_multiplier
    check (multiplier_type = 'none' or (remarks is not null and length(trim(remarks)) > 0))
);

create index pireps_pilot_idx on pireps(pilot_id);
create index pireps_claim_idx on pireps(claim_id);
create index pireps_review_status_idx on pireps(review_status);

alter table pireps enable row level security;
create policy "pilot read own pireps" on pireps for select using (auth.uid() = pilot_id);
create policy "staff read all pireps" on pireps for select using (is_staff());
create policy "pilot insert own pirep" on pireps for insert with check (auth.uid() = pilot_id);
create policy "staff update pireps" on pireps for update using (is_staff()) with check (is_staff());
