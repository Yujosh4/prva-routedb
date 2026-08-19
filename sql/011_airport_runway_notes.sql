-- Staff-entered advisory about an airport's real runway-use quirks that
-- SimBrief's own routing doesn't know (e.g. a runway that's departure-only
-- in practice, or reserved for a specific aircraft category). Optional,
-- blank by default -- shown next to weather in the route details modal
-- only when staff has actually filled it in for that airport. Not
-- auto-generated: a fabricated runway rule would be worse than none.
-- Edit directly via the Supabase Table Editor (airports table) -- this is
-- a rarely-touched field, not worth a dedicated staff page.
alter table airports add column runway_notes text;
