alter table public.batches
  add column if not exists status text not null default 'Upcoming';
