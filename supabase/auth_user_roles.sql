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

alter table public.roles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "roles_read_active" on public.roles;
drop policy if exists "user_roles_read_own" on public.user_roles;

create policy "roles_read_active"
  on public.roles for select
  using (active = true);

create policy "user_roles_read_own"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Replace this email with the admin user you created in Supabase Authentication.
insert into public.user_roles (
  user_id,
  role_id,
  display_name,
  login_email,
  active
)
select
  id,
  'admin',
  coalesce(raw_user_meta_data->>'name', email, 'System Administrator'),
  email,
  true
from auth.users
where email = 'REPLACE_WITH_ADMIN_EMAIL'
on conflict (user_id) do update set
  role_id = excluded.role_id,
  display_name = excluded.display_name,
  login_email = excluded.login_email,
  active = excluded.active,
  updated_at = now();
