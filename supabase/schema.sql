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
  status text not null default 'Upcoming',
  sessions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.batches
  add column if not exists status text not null default 'Upcoming';

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

create table if not exists public.roles (
  id text primary key,
  name text not null unique,
  description text,
  can_manage_masters boolean not null default false,
  can_review_registrations boolean not null default false,
  can_mark_attendance boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.roles (
  id,
  name,
  description,
  can_manage_masters,
  can_review_registrations,
  can_mark_attendance,
  active
)
values
  ('admin', 'Admin', 'Full administrative access', true, true, true, true),
  ('teacher', 'Teacher', 'Faculty attendance and program access', false, false, true, true),
  ('participant', 'Participant', 'Participant self-service access', false, false, false, true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  can_manage_masters = excluded.can_manage_masters,
  can_review_registrations = excluded.can_review_registrations,
  can_mark_attendance = excluded.can_mark_attendance,
  active = excluded.active,
  updated_at = now();

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_id text not null references public.roles(id) on delete restrict,
  display_name text not null,
  login_email text,
  linked_teacher_id text references public.teachers(id) on delete set null,
  linked_participant_id text references public.participants(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles
  add column if not exists login_email text;

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
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;

create policy "temporary_demo_read_app_state"
  on public.app_state for select
  using (true);

create policy "temporary_demo_write_app_state"
  on public.app_state for all
  using (true)
  with check (true);

drop policy if exists "user_roles_read_own" on public.user_roles;
drop policy if exists "roles_read_active" on public.roles;

create policy "roles_read_active"
  on public.roles for select
  using (active = true);

create policy "user_roles_read_own"
  on public.user_roles for select
  using (auth.uid() = user_id);
