-- 001_schema.sql added RLS policies for storage.objects (individual files)
-- but missed one for storage.buckets itself (the bucket's own metadata row) --
-- without it, the bucket exists but is invisible to list/get calls, which is
-- why it looked missing even though the dashboard correctly says it's
-- already there.

drop policy if exists "public read bucket info" on storage.buckets;
create policy "public read bucket info" on storage.buckets for select using (true);
