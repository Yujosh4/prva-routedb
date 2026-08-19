-- Adds a distinct provenance value for schedule rows sourced from PAL's
-- own published timetable PDFs, so they're not lumped in with the
-- AviationStack-derived 'real_world_api' rows or the fully-synthetic
-- 'derived' ones -- staff can tell at a glance which rows are grounded in
-- an actual published schedule vs a plausible guess.
alter table career_schedules drop constraint career_schedules_source_check;
alter table career_schedules add constraint career_schedules_source_check
  check (source in ('real_world_api', 'real_world_pdf', 'manual', 'derived'));
