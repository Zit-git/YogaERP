-- Restores RLS after legacy demo scripts disabled it.
-- Safe to run repeatedly in the Supabase SQL Editor.

begin;

alter table if exists public.course_masters enable row level security;
alter table if exists public.course_session_templates enable row level security;
alter table if exists public.teachers enable row level security;
alter table if exists public.program_halls enable row level security;
alter table if exists public.accommodation_blocks enable row level security;
alter table if exists public.accommodation_floors enable row level security;
alter table if exists public.rooms enable row level security;
alter table if exists public.batches enable row level security;
alter table if exists public.batch_sessions enable row level security;
alter table if exists public.participants enable row level security;
alter table if exists public.registrations enable row level security;
alter table if exists public.session_attendance enable row level security;
alter table if exists public.hall_bookings enable row level security;
alter table if exists public.roles enable row level security;
alter table if exists public.user_roles enable row level security;

commit;

-- Every returned row should show rls_enabled = true.
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename in (
    'course_masters',
    'course_session_templates',
    'teachers',
    'program_halls',
    'accommodation_blocks',
    'accommodation_floors',
    'rooms',
    'batches',
    'batch_sessions',
    'participants',
    'registrations',
    'session_attendance',
    'hall_bookings',
    'roles',
    'user_roles'
  )
order by tablename;
