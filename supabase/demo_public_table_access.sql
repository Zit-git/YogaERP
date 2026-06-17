alter table public.course_masters disable row level security;
alter table public.teachers disable row level security;
alter table public.program_halls disable row level security;
alter table public.accommodation_blocks disable row level security;
alter table public.accommodation_floors disable row level security;
alter table public.rooms disable row level security;
alter table public.batches disable row level security;
alter table public.participants disable row level security;
alter table public.registrations disable row level security;
alter table public.hall_bookings disable row level security;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.course_masters to anon, authenticated;
grant select, insert, update, delete on table public.teachers to anon, authenticated;
grant select, insert, update, delete on table public.program_halls to anon, authenticated;
grant select, insert, update, delete on table public.accommodation_blocks to anon, authenticated;
grant select, insert, update, delete on table public.accommodation_floors to anon, authenticated;
grant select, insert, update, delete on table public.rooms to anon, authenticated;
grant select, insert, update, delete on table public.batches to anon, authenticated;
grant select, insert, update, delete on table public.participants to anon, authenticated;
grant select, insert, update, delete on table public.registrations to anon, authenticated;
grant select, insert, update, delete on table public.hall_bookings to anon, authenticated;
