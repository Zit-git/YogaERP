-- Public access is controlled by policies; RLS must remain enabled.
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
