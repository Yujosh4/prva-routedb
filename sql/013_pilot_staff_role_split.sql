-- Crew Center needs real pilot accounts (Supabase Auth, email/password,
-- self-signup) -- but until now every "staff write" RLS policy checked
-- only auth.role() = 'authenticated', which was fine when "authenticated"
-- and "staff" were the same set of people by construction (no public
-- signup, staff accounts created manually in the dashboard). Once pilots
-- can sign themselves up, that stops being true: a pilot's own account
-- would otherwise inherit staff-level write access to routes/airlines/etc.
--
-- Fix: a real is_staff() check, backed by app_metadata.is_staff on the
-- Supabase Auth user -- set the same manual way staff accounts have
-- always been created (Dashboard -> Authentication -> Users -> edit user
-- -> User Metadata -> add "is_staff": true to App Metadata, NOT User
-- Metadata, since only app_metadata is trusted server-side / included in
-- the JWT in a way a user can't self-edit). Every existing "staff write"
-- policy is recreated here to check is_staff() instead of bare
-- `authenticated`; nothing about what staff can already do changes, this
-- only closes the gap for pilot accounts that don't exist yet.

create or replace function is_staff() returns boolean as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_staff')::boolean, false);
$$ language sql stable;

-- ---------- airlines / airports / routes (001_schema.sql) ----------
drop policy if exists "staff write airlines" on airlines;
create policy "staff write airlines" on airlines for all
  using (is_staff()) with check (is_staff());

drop policy if exists "staff write airports" on airports;
create policy "staff write airports" on airports for all
  using (is_staff()) with check (is_staff());

drop policy if exists "staff write routes" on routes;
create policy "staff write routes" on routes for all
  using (is_staff()) with check (is_staff());

-- ---------- airline-logos storage bucket (001b_storage_bucket_retry.sql) ----------
drop policy if exists "staff upload airline logos" on storage.objects;
create policy "staff upload airline logos" on storage.objects for insert
  with check (bucket_id = 'airline-logos' and is_staff());

drop policy if exists "staff update airline logos" on storage.objects;
create policy "staff update airline logos" on storage.objects for update
  using (bucket_id = 'airline-logos' and is_staff());

drop policy if exists "staff delete airline logos" on storage.objects;
create policy "staff delete airline logos" on storage.objects for delete
  using (bucket_id = 'airline-logos' and is_staff());

-- ---------- ranks / career_schedules (007_career_mode_schema.sql) ----------
drop policy if exists "staff write ranks" on ranks;
create policy "staff write ranks" on ranks for all
  using (is_staff()) with check (is_staff());

drop policy if exists "staff write career_schedules" on career_schedules;
create policy "staff write career_schedules" on career_schedules for all
  using (is_staff()) with check (is_staff());

-- ---------- career_mode_roster (010_career_mode_roster_by_month.sql) ----------
drop policy if exists "staff write career_mode_roster" on career_mode_roster;
create policy "staff write career_mode_roster" on career_mode_roster for all
  using (is_staff()) with check (is_staff());
