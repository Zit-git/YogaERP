create table if not exists public.teachers (
  id text primary key,
  name text not null,
  speciality text,
  phone text,
  email text,
  photo text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teachers enable row level security;

drop policy if exists "temporary_demo_read_teachers" on public.teachers;
drop policy if exists "temporary_demo_write_teachers" on public.teachers;

create policy "temporary_demo_read_teachers"
  on public.teachers
  for select
  using (true);

create policy "temporary_demo_write_teachers"
  on public.teachers
  for all
  using (true)
  with check (true);
