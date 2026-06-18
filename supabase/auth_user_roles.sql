create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
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

alter table public.user_roles enable row level security;

drop policy if exists "user_roles_read_own" on public.user_roles;

create policy "user_roles_read_own"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Replace this email with the admin user you created in Supabase Authentication.
insert into public.user_roles (
  user_id,
  role,
  display_name,
  can_manage_masters,
  can_review_registrations,
  can_mark_attendance,
  active
)
select
  id,
  'admin',
  coalesce(raw_user_meta_data->>'name', email, 'System Administrator'),
  true,
  true,
  true,
  true
from auth.users
where email = 'REPLACE_WITH_ADMIN_EMAIL'
on conflict (user_id) do update set
  role = excluded.role,
  display_name = excluded.display_name,
  can_manage_masters = excluded.can_manage_masters,
  can_review_registrations = excluded.can_review_registrations,
  can_mark_attendance = excluded.can_mark_attendance,
  active = excluded.active,
  updated_at = now();
