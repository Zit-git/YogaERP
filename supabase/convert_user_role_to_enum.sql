do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'teacher', 'participant');
  end if;
end $$;

alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  alter column role type public.app_role
  using role::public.app_role;
