insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'datasets',
  'datasets',
  false,
  6291456,
  array[
    'application/json',
    'application/jsonl',
    'application/x-ndjson',
    'application/octet-stream',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own datasets" on storage.objects;
create policy "Users read own datasets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users upload own datasets" on storage.objects;
create policy "Users upload own datasets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own datasets" on storage.objects;
create policy "Users update own datasets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own datasets" on storage.objects;
create policy "Users delete own datasets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
