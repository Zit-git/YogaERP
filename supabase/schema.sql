create extension if not exists pgcrypto;

create table if not exists public.app_state (
  id text primary key default 'current',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_masters (
  id text primary key,
  parent_id text references public.course_masters(id) on delete restrict,
  code text not null,
  name text not null,
  level text not null,
  duration text,
  eligibility text,
  session_templates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.program_halls (
  id text primary key,
  name text not null,
  capacity integer not null default 1,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accommodation_blocks (
  id text primary key,
  name text not null,
  gender text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accommodation_floors (
  id text primary key,
  block_id text references public.accommodation_blocks(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id text primary key,
  block_id text references public.accommodation_blocks(id) on delete restrict,
  floor_id text references public.accommodation_floors(id) on delete restrict,
  name text not null,
  gender text,
  beds integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batches (
  id text primary key,
  program_id text references public.course_masters(id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  seats integer not null default 1,
  hall_id text references public.program_halls(id) on delete set null,
  teacher_id text references public.teachers(id) on delete set null,
  teacher_name text,
  eligibility text,
  sessions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id text primary key,
  name text not null,
  age integer,
  gender text,
  phone text unique,
  email text,
  address text,
  emergency_contact text,
  photo text,
  notes text,
  program_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id text primary key,
  participant_id text not null references public.participants(id) on delete cascade,
  batch_id text references public.batches(id) on delete restrict,
  status text not null default 'Pending',
  eligible boolean not null default false,
  room_id text references public.rooms(id) on delete set null,
  checked_in boolean not null default false,
  attendance integer not null default 0,
  completion text not null default 'Pending',
  certificate boolean not null default false,
  session_attendance jsonb not null default '[]'::jsonb,
  notes text,
  registered_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hall_bookings (
  id text primary key,
  batch_id text references public.batches(id) on delete cascade,
  hall_id text references public.program_halls(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key default gen_random_uuid()::text,
  login_id text not null unique,
  role text not null check (role in ('admin', 'teacher', 'participant')),
  display_name text not null,
  linked_teacher_id text references public.teachers(id) on delete set null,
  linked_participant_id text references public.participants(id) on delete set null,
  can_manage_masters boolean not null default false,
  can_review_registrations boolean not null default false,
  can_mark_attendance boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
alter table public.course_masters enable row level security;
alter table public.teachers enable row level security;
alter table public.program_halls enable row level security;
alter table public.accommodation_blocks enable row level security;
alter table public.accommodation_floors enable row level security;
alter table public.rooms enable row level security;
alter table public.batches enable row level security;
alter table public.participants enable row level security;
alter table public.registrations enable row level security;
alter table public.hall_bookings enable row level security;
alter table public.users enable row level security;

create policy "temporary_demo_read_app_state"
  on public.app_state for select
  using (true);

create policy "temporary_demo_write_app_state"
  on public.app_state for all
  using (true)
  with check (true);

drop policy if exists "temporary_demo_read_users" on public.users;
drop policy if exists "temporary_demo_write_users" on public.users;

create policy "temporary_demo_read_users"
  on public.users for select
  using (true);

create policy "temporary_demo_write_users"
  on public.users for all
  using (true)
  with check (true);
