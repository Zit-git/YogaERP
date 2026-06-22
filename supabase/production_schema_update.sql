alter table public.teachers
  add column if not exists title text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists contact_number text,
  add column if not exists education text,
  add column if not exists gender text,
  add column if not exists marital_status text;

alter table public.registrations
  add column if not exists accommodation_type text not null default 'Not Required',
  add column if not exists checkin_date date,
  add column if not exists checkout_date date,
  add column if not exists checked_out boolean not null default false,
  add column if not exists pricing_category text,
  add column if not exists amount numeric not null default 0,
  add column if not exists payment_status text not null default 'Enquiry';

alter table public.rooms
  add column if not exists status text not null default 'Clean',
  add column if not exists cleaning_notes text;

alter table public.course_masters
  add column if not exists teacher_ids jsonb not null default '[]'::jsonb,
  add column if not exists pricing_tiers jsonb not null default '[{"category":"General","amount":1500},{"category":"Students","amount":150},{"category":"Refresher","amount":750}]'::jsonb;

alter table public.batches
  add column if not exists status text not null default 'Upcoming';

create table if not exists public.course_session_templates (
  id text primary key,
  program_id text not null references public.course_masters(id) on delete cascade,
  day_number integer not null default 1,
  title text not null,
  time text,
  topic text,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batch_sessions (
  id text primary key,
  batch_id text not null references public.batches(id) on delete cascade,
  session_date date not null,
  title text not null,
  time text,
  topic text,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.session_attendance (
  id text primary key,
  registration_id text not null references public.registrations(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  batch_id text references public.batches(id) on delete cascade,
  batch_session_id text not null references public.batch_sessions(id) on delete cascade,
  status text not null default 'Present',
  reason text,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.course_session_templates (
  id,
  program_id,
  day_number,
  title,
  time,
  topic,
  display_order,
  updated_at
)
select
  template.value ->> 'id',
  course.id,
  coalesce(nullif(template.value ->> 'day', '')::integer, 1),
  coalesce(template.value ->> 'title', ''),
  template.value ->> 'time',
  template.value ->> 'topic',
  template.ordinality,
  now()
from public.course_masters course
cross join lateral jsonb_array_elements(course.session_templates) with ordinality as template(value, ordinality)
where template.value ? 'id'
on conflict (id) do update set
  program_id = excluded.program_id,
  day_number = excluded.day_number,
  title = excluded.title,
  time = excluded.time,
  topic = excluded.topic,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.batch_sessions (
  id,
  batch_id,
  session_date,
  title,
  time,
  topic,
  display_order,
  updated_at
)
select
  session.value ->> 'id',
  batch.id,
  nullif(session.value ->> 'date', '')::date,
  coalesce(session.value ->> 'title', ''),
  session.value ->> 'time',
  session.value ->> 'topic',
  session.ordinality,
  now()
from public.batches batch
cross join lateral jsonb_array_elements(batch.sessions) with ordinality as session(value, ordinality)
where session.value ? 'id'
  and session.value ? 'date'
  and nullif(session.value ->> 'date', '') is not null
on conflict (id) do update set
  batch_id = excluded.batch_id,
  session_date = excluded.session_date,
  title = excluded.title,
  time = excluded.time,
  topic = excluded.topic,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.session_attendance (
  id,
  registration_id,
  participant_id,
  batch_id,
  batch_session_id,
  status,
  reason,
  marked_at,
  updated_at
)
select
  left(registration.id || '-' || (attendance.value ->> 'sessionId'), 250),
  registration.id,
  registration.participant_id,
  registration.batch_id,
  attendance.value ->> 'sessionId',
  coalesce(attendance.value ->> 'status', 'Present'),
  attendance.value ->> 'reason',
  now(),
  now()
from public.registrations registration
cross join lateral jsonb_array_elements(registration.session_attendance) as attendance(value)
where attendance.value ? 'sessionId'
  and exists (
    select 1
    from public.batch_sessions session
    where session.id = attendance.value ->> 'sessionId'
  )
on conflict (id) do update set
  registration_id = excluded.registration_id,
  participant_id = excluded.participant_id,
  batch_id = excluded.batch_id,
  batch_session_id = excluded.batch_session_id,
  status = excluded.status,
  reason = excluded.reason,
  marked_at = excluded.marked_at,
  updated_at = now();

alter table public.course_session_templates enable row level security;
alter table public.batch_sessions enable row level security;
alter table public.session_attendance enable row level security;

drop policy if exists "temporary_demo_read_course_session_templates" on public.course_session_templates;
drop policy if exists "temporary_demo_write_course_session_templates" on public.course_session_templates;
drop policy if exists "temporary_demo_read_batch_sessions" on public.batch_sessions;
drop policy if exists "temporary_demo_write_batch_sessions" on public.batch_sessions;
drop policy if exists "temporary_demo_read_session_attendance" on public.session_attendance;
drop policy if exists "temporary_demo_write_session_attendance" on public.session_attendance;

create policy "temporary_demo_read_course_session_templates" on public.course_session_templates for select using (true);
create policy "temporary_demo_write_course_session_templates" on public.course_session_templates for all using (true) with check (true);

create policy "temporary_demo_read_batch_sessions" on public.batch_sessions for select using (true);
create policy "temporary_demo_write_batch_sessions" on public.batch_sessions for all using (true) with check (true);

create policy "temporary_demo_read_session_attendance" on public.session_attendance for select using (true);
create policy "temporary_demo_write_session_attendance" on public.session_attendance for all using (true) with check (true);
