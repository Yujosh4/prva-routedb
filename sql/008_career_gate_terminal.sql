-- Gate/terminal are optional, staff-set fields -- not auto-generated, since
-- a fabricated gate number would be meaningless. Blank means "not assigned
-- yet", shown as TBD rather than a made-up value.
alter table career_schedules add column gate text;
alter table career_schedules add column terminal text;
