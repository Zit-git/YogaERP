# Supabase Setup

## 1. Create Supabase Project

1. Open Supabase and create a new project.
2. Go to SQL Editor.
3. Open [supabase/schema.sql](supabase/schema.sql).
4. Run the full SQL script.
5. Open and run [supabase/all_tables_sync_policy.sql](supabase/all_tables_sync_policy.sql) for the current prototype. Without this step, Supabase will reject browser reads/writes with a row-level security error.
6. Create users in **Supabase Authentication > Users**.
7. Open [supabase/auth_user_roles.sql](supabase/auth_user_roles.sql), replace `REPLACE_WITH_ADMIN_EMAIL` with your admin Auth user email, then run it.

The app now reads/writes only normalized Supabase tables. Browser-local record storage and the old `app_state` JSON snapshot are disabled.
For an existing project, run [supabase/drop_app_state_snapshot.sql](supabase/drop_app_state_snapshot.sql) once to remove the old snapshot table.

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

Login is controlled by Supabase Authentication. Role definitions and app permissions are controlled by `public.roles`. Each user is linked to one role through `public.user_roles.role_id`.

- Login with the email and password created in **Supabase Authentication > Users**.
- Add one row in `public.user_roles` for each Auth user.
- Choose the user's role from `public.roles.id`.
- Admin users can manage roles and user assignments from the app menu: **Users & Roles**.
- To create users from the app, keep email/password signups enabled in **Supabase Authentication > Providers > Email**.

For the admin user, run [supabase/auth_user_roles.sql](supabase/auth_user_roles.sql) after replacing the email placeholder.
If your existing Supabase project already has `public.user_roles.role`, run [supabase/migrate_user_roles_to_role_master.sql](supabase/migrate_user_roles_to_role_master.sql) once. It creates the Roles Master, copies existing role values to `role_id`, and removes the old role/permission columns from `public.user_roles`.

Default roles are:

- `admin`
- `teacher`
- `participant`

To add more roles later, insert a new row in `public.roles` and set:

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
