-- Standalone retry of the storage bucket portion of 001_schema.sql --
-- the tables/RLS from 001 landed fine, but the bucket itself didn't get
-- created for some reason. Safe to run even if some of this partially
-- exists already (each statement checks first).

insert into storage.buckets (id, name, public)
values ('airline-logos', 'airline-logos', true)
on conflict (id) do nothing;

drop policy if exists "public read airline logos" on storage.objects;
drop policy if exists "staff upload airline logos" on storage.objects;
drop policy if exists "staff update airline logos" on storage.objects;
drop policy if exists "staff delete airline logos" on storage.objects;

create policy "public read airline logos" on storage.objects for select
  using (bucket_id = 'airline-logos');
create policy "staff upload airline logos" on storage.objects for insert
  with check (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
create policy "staff update airline logos" on storage.objects for update
  using (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
create policy "staff delete airline logos" on storage.objects for delete
  using (bucket_id = 'airline-logos' and auth.role() = 'authenticated');
