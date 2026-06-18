create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key default gen_random_uuid()::text,
  login_id text not null unique,
  password text not null default 'changeme',
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

alter table public.users
  add column if not exists password text not null default 'changeme';

alter table public.users enable row level security;

drop policy if exists "temporary_demo_read_users" on public.users;
drop policy if exists "temporary_demo_write_users" on public.users;

create policy "temporary_demo_read_users"
  on public.users for select
  using (true);

create policy "temporary_demo_write_users"
  on public.users for all
  using (true)
  with check (true);

insert into public.users (
  id,
  login_id,
  password,
  role,
  display_name,
  can_manage_masters,
  can_review_registrations,
  can_mark_attendance,
  active
) values (
  'user-admin',
  'admin',
  'admin123',
  'admin',
  'System Administrator',
  true,
  true,
  true,
  true
)
on conflict (login_id) do update set
  role = excluded.role,
  password = excluded.password,
  display_name = excluded.display_name,
  can_manage_masters = excluded.can_manage_masters,
  can_review_registrations = excluded.can_review_registrations,
  can_mark_attendance = excluded.can_mark_attendance,
  active = excluded.active,
  updated_at = now();

insert into public.users (
  id,
  login_id,
  password,
  role,
  display_name,
  linked_teacher_id,
  can_manage_masters,
  can_review_registrations,
  can_mark_attendance,
  active
)
select
  'user-teacher-' || teachers.id,
  coalesce(nullif(teachers.email, ''), teachers.id),
  'changeme',
  'teacher',
  teachers.name,
  teachers.id,
  false,
  false,
  true,
  true
from public.teachers
on conflict (login_id) do update set
  role = excluded.role,
  password = excluded.password,
  display_name = excluded.display_name,
  linked_teacher_id = excluded.linked_teacher_id,
  can_manage_masters = excluded.can_manage_masters,
  can_review_registrations = excluded.can_review_registrations,
  can_mark_attendance = excluded.can_mark_attendance,
  active = excluded.active,
  updated_at = now();

insert into public.users (
  id,
  login_id,
  password,
  role,
  display_name,
  linked_participant_id,
  can_manage_masters,
  can_review_registrations,
  can_mark_attendance,
  active
)
select
  'user-participant-' || participants.id,
  coalesce(nullif(participants.phone, ''), participants.id),
  'changeme',
  'participant',
  participants.name,
  participants.id,
  false,
  false,
  false,
  true
from public.participants
on conflict (login_id) do update set
  role = excluded.role,
  password = excluded.password,
  display_name = excluded.display_name,
  linked_participant_id = excluded.linked_participant_id,
  can_manage_masters = excluded.can_manage_masters,
  can_review_registrations = excluded.can_review_registrations,
  can_mark_attendance = excluded.can_mark_attendance,
  active = excluded.active,
  updated_at = now();
