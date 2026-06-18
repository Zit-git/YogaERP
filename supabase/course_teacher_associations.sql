alter table public.course_masters
  add column if not exists teacher_ids jsonb not null default '[]'::jsonb;
