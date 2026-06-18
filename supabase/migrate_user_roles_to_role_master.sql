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

alter table public.user_roles
  add column if not exists role_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'role'
  ) then
    update public.user_roles
    set role_id = role::text
    where role_id is null;
  end if;
end $$;

update public.user_roles
set role_id = 'participant'
where role_id is null;

alter table public.user_roles
  alter column role_id set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'user_roles'
      and constraint_name = 'user_roles_role_id_fkey'
  ) then
    alter table public.user_roles
      add constraint user_roles_role_id_fkey
      foreign key (role_id)
      references public.roles(id)
      on delete restrict;
  end if;
end $$;

alter table public.user_roles
  drop column if exists role,
  drop column if exists can_manage_masters,
  drop column if exists can_review_registrations,
  drop column if exists can_mark_attendance;

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
