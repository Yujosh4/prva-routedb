-- Career Mode originally showed every scheduled PAL/PAL Express route on
-- every day it operated (~150+ routes matching any given day even after
-- realistic day-of-week patterns), which felt overwhelming rather than
-- like a curated set of actual duty assignments. This adds a flag staff
-- set via a one-click "Generate Career Mode Roster" tool -- a capped,
-- deterministic subset of currently-scheduled routes is marked in_career_mode
-- and only those show up on the pilot-facing career.html page. Everything
-- else stays scheduled/tracked in the Route Network Database as normal,
-- just not surfaced in Career Mode.
alter table career_schedules add column in_career_mode boolean not null default false;
