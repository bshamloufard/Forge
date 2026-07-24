insert into storage.buckets (id, name, public, file_size_limit)
values ('checkpoints', 'checkpoints', false, 5368709120)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
