alter table public.app_state enable row level security;
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

drop policy if exists "temporary_demo_read_course_masters" on public.course_masters;
drop policy if exists "temporary_demo_write_course_masters" on public.course_masters;
drop policy if exists "temporary_demo_read_teachers" on public.teachers;
drop policy if exists "temporary_demo_write_teachers" on public.teachers;
drop policy if exists "temporary_demo_read_program_halls" on public.program_halls;
drop policy if exists "temporary_demo_write_program_halls" on public.program_halls;
drop policy if exists "temporary_demo_read_accommodation_blocks" on public.accommodation_blocks;
drop policy if exists "temporary_demo_write_accommodation_blocks" on public.accommodation_blocks;
drop policy if exists "temporary_demo_read_accommodation_floors" on public.accommodation_floors;
drop policy if exists "temporary_demo_write_accommodation_floors" on public.accommodation_floors;
drop policy if exists "temporary_demo_read_rooms" on public.rooms;
drop policy if exists "temporary_demo_write_rooms" on public.rooms;
drop policy if exists "temporary_demo_read_batches" on public.batches;
drop policy if exists "temporary_demo_write_batches" on public.batches;
drop policy if exists "temporary_demo_read_participants" on public.participants;
drop policy if exists "temporary_demo_write_participants" on public.participants;
drop policy if exists "temporary_demo_read_registrations" on public.registrations;
drop policy if exists "temporary_demo_write_registrations" on public.registrations;
drop policy if exists "temporary_demo_read_hall_bookings" on public.hall_bookings;
drop policy if exists "temporary_demo_write_hall_bookings" on public.hall_bookings;

create policy "temporary_demo_read_course_masters" on public.course_masters for select using (true);
create policy "temporary_demo_write_course_masters" on public.course_masters for all using (true) with check (true);

create policy "temporary_demo_read_teachers" on public.teachers for select using (true);
create policy "temporary_demo_write_teachers" on public.teachers for all using (true) with check (true);

create policy "temporary_demo_read_program_halls" on public.program_halls for select using (true);
create policy "temporary_demo_write_program_halls" on public.program_halls for all using (true) with check (true);

create policy "temporary_demo_read_accommodation_blocks" on public.accommodation_blocks for select using (true);
create policy "temporary_demo_write_accommodation_blocks" on public.accommodation_blocks for all using (true) with check (true);

create policy "temporary_demo_read_accommodation_floors" on public.accommodation_floors for select using (true);
create policy "temporary_demo_write_accommodation_floors" on public.accommodation_floors for all using (true) with check (true);

create policy "temporary_demo_read_rooms" on public.rooms for select using (true);
create policy "temporary_demo_write_rooms" on public.rooms for all using (true) with check (true);

create policy "temporary_demo_read_batches" on public.batches for select using (true);
create policy "temporary_demo_write_batches" on public.batches for all using (true) with check (true);

create policy "temporary_demo_read_participants" on public.participants for select using (true);
create policy "temporary_demo_write_participants" on public.participants for all using (true) with check (true);

create policy "temporary_demo_read_registrations" on public.registrations for select using (true);
create policy "temporary_demo_write_registrations" on public.registrations for all using (true) with check (true);

create policy "temporary_demo_read_hall_bookings" on public.hall_bookings for select using (true);
create policy "temporary_demo_write_hall_bookings" on public.hall_bookings for all using (true) with check (true);
