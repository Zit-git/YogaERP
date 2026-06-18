# Supabase Setup

## 1. Create Supabase Project

1. Open Supabase and create a new project.
2. Go to SQL Editor.
3. Open [supabase/schema.sql](supabase/schema.sql).
4. Run the full SQL script.
5. Open and run [supabase/all_tables_sync_policy.sql](supabase/all_tables_sync_policy.sql) for the current prototype. Without this step, Supabase will reject browser reads/writes with a row-level security error.
6. Open and run [supabase/users_and_roles.sql](supabase/users_and_roles.sql) after teachers and participants exist. This creates the admin user and creates teacher/participant login rows from current Supabase records.

The app now reads/writes only Supabase records. Browser-local record storage is disabled.

## 2. Add Project Credentials

In Supabase:

1. Go to Project Settings.
2. Open API.
3. Copy the Project URL.
4. Copy the anon public key.

Update [supabase-config.js](supabase-config.js):

```js
window.ALIYAR_SUPABASE = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-key"
};
```

Refresh the app. The sidebar should show `Supabase connected` or `Supabase synced`.

## 3. Users And Roles

Login is controlled by the `public.users` table.

- Admin login: `admin`
- Teacher login: teacher email, created from `public.teachers`
- Participant login: participant phone number, created from `public.participants`

Permissions are controlled by:

- `can_manage_masters`
- `can_review_registrations`
- `can_mark_attendance`

## 4. Current Security Note

The current sync step uses temporary demo policies so the static app can read and write while we wire real Supabase Auth.

Before production:

- Re-enable row-level security and replace demo access with authenticated role policies.
- Move login to Supabase Auth.
- Replace open demo policies with authenticated user policies.
- Add backup/export jobs.

## 5. Recommended Next Backend Step

After credentials are connected, migrate in this order:

1. Course Master and session templates
2. Teachers
3. Batches and hall bookings
4. Participants
5. Registrations and attendance
6. Accommodation
7. Certificates and history
