create table if not exists public.app_state (
  id text primary key default 'current',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "temporary_demo_read_app_state" on public.app_state;
drop policy if exists "temporary_demo_write_app_state" on public.app_state;

create policy "temporary_demo_read_app_state"
  on public.app_state
  for select
  using (true);

create policy "temporary_demo_write_app_state"
  on public.app_state
  for all
  using (true)
  with check (true);
