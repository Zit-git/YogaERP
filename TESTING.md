# Aliyar Programs Testing Guide

This app should be tested against a Supabase test project before testing with live operational data.

## 1. Test Environment

- Use a separate Supabase project for testing.
- Run the latest schema scripts listed in `SUPABASE_SETUP.md`.
- Confirm Row Level Security fixes by running `supabase/fix_security_lints.sql`.
- Use test users for each role:
  - Admin
  - Teacher
  - Participant
- Confirm that new records are visible in Supabase Table Editor after each save.

## 2. Smoke Test

Run these before every release:

- Open the app locally.
- Confirm the Portal page loads without login.
- Login as Admin.
- Refresh the page and confirm the session remains active.
- Open the app in a second tab and confirm login persists.
- Navigate every left menu item.
- Confirm each menu opens the records list, not a stale detail view.
- Confirm no raw Supabase SQL error is shown to the user.

## 3. Admin Workflow Tests

### Courses

- Add a course with code, duration, hierarchy, eligibility, and pricing tiers.
- Add multiple pricing categories, such as General, Student, Refresher, and Ex-Servicemen.
- Edit the course and verify changes persist.
- Map multiple teachers to the course.
- Add, edit, and delete course session plans.
- Open the course detail view and verify:
  - Course details
  - Course hierarchy
  - Session plan
  - Programs conducted
  - Teacher mapping

### Programs

- Add a program from an existing course.
- Confirm only teachers mapped to the selected course appear.
- Assign a program hall.
- Edit the program.
- Confirm active programs appear in the default Programs list.
- Confirm completed programs are hidden by default and visible under All Programs.
- Open the program detail by clicking the row.
- Confirm removed actions are not visible:
  - Apply Course Sessions
  - Register Participant

### Dashboard

- Confirm the dashboard calendar opens to the current month.
- Confirm current, upcoming, and completed programs are shown with different colors.
- Confirm a multi-day program appears continuously across dates.
- Confirm overlapping programs on the same dates are visible separately.
- Click a program in the calendar and confirm it opens the program detail.

### Registrations

- Add a single registration from the Registrations module.
- Add multiple registrations in bulk.
- Confirm registration fields are captured:
  - Name
  - Phone
  - Email
  - Address
  - Age
  - Gender
  - Accommodation type
  - Pricing category
  - Payment status
- Confirm the program dropdown lists active programs.
- Confirm registrations are grouped by program.
- Confirm duplicate participants are not created when phone or email already exists.
- Confirm refresher registration pricing applies only after completion verification.
- Confirm seat count reduces after confirmed registration.
- Confirm excess registrations are waitlisted.
- Cancel a registration and confirm seat/waitlist/accommodation impact.
- Mark a dropout and confirm accommodation is released or flagged correctly.

### Participants

- Open participant detail by clicking a row.
- Confirm personal profile is shown:
  - Photo
  - Name
  - Phone
  - Email
  - Address
  - Age
  - Gender
- Confirm program-specific data is inside the program history/subform, not mixed into the main profile.
- Confirm completed programs and certificates are visible.

### Teachers

- Confirm Teachers module lists active teachers.
- Add a teacher profile with:
  - Title
  - First name
  - Last name
  - Gender
  - Phone/contact number
  - Email
  - Photo
  - Educational qualification
  - Marital status
- Edit the teacher and verify updates persist.
- Open teacher detail by clicking a row.
- Confirm course mappings are shown.
- Confirm programs conducted are shown.
- Confirm the back arrow returns to the records list.

### Attendance

- Open an active program.
- Confirm session attendance is available inside the active program.
- Confirm every participant has P/L/A options:
  - Present
  - Late
  - Absent
- Click Mark All Present.
- Change one participant to Late with reason.
- Change one participant to Absent with reason.
- Confirm attendance can be corrected later.
- Confirm participants with full attendance are marked completed.

### Accommodation

- Add blocks.
- Add floors under blocks.
- Confirm floor list shows block name, not block ID.
- Add rooms under floors.
- Confirm room type options:
  - Single Occupancy
  - Double Occupancy
  - Dormitory
- Confirm accommodation pricing is included with program cost.
- Confirm dirty rooms are not available for check-in.
- Confirm cleaned rooms become available.
- Confirm rooms checked out today are held for cleaning before reuse.

### Room Allotment

- Open Room Allotment as a separate module.
- Select check-in and checkout dates.
- Confirm available rooms list appears.
- Confirm overlapping stays are blocked.
- Allot a room to a participant.
- Check in the participant.
- Check out the participant.
- Confirm the room becomes dirty after checkout.
- Mark room cleaned and confirm it becomes available again.
- Test overlapping program dates:
  - Program A: 22 to 25
  - Program B: 24 to 26
  - Program C: starts 25
- Confirm Program A rooms are not available for Program C until cleaned.

### Program Halls

- Add program halls.
- Add hall bookings from inside Program Halls.
- Assign a hall to a program.
- Confirm overlapping hall bookings are handled correctly.

### Users And Roles

- Add a user from the app.
- Assign role from the app, not Supabase Table Editor.
- Login as the user.
- Confirm permissions match role:
  - Participants can view their records, edit personal details, and view certificates.
  - Teachers can view assigned programs, mark attendance, and manage profile.
  - Admins have full access.

## 4. Table Behavior Tests

Every master/list table should be tested for:

- Row click opens full detail view.
- Back arrow returns to records list.
- Sorting works ascending and descending from the header icon.
- Filtering works from the header filter control.
- Pagination works from the table footer.
- Add, edit, delete, and bulk edit appear where relevant.
- No search or sort controls outside the table unless intentionally designed.

## 5. Supabase Persistence Checks

After each workflow:

- Refresh the browser and confirm data remains.
- Open another browser tab and confirm the same data appears.
- Check Supabase Table Editor for the changed table.
- Confirm no data is stored as browser-only business data.
- Browser storage should be used only for the login session or UI preferences.

## 6. Release Checklist

Before pushing/deploying:

- Run `node --check app.js`.
- Run `git diff --check`.
- Test login refresh and second-tab session.
- Test at least one create/edit/delete operation in each major module.
- Test one registration with pricing and accommodation.
- Test one room allotment through check-in and checkout.
- Test one attendance session with Present, Late, and Absent.
- Re-run Supabase Security Advisor.
- Confirm no visible developer/test buttons are shown in production.
