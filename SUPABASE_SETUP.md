# Supabase Setup

## 1. Create Supabase Project

1. Open Supabase and create a new project.
2. Go to SQL Editor.
3. For the current static app sync, open [supabase/app_state_only.sql](supabase/app_state_only.sql).
4. Run the full SQL script.
5. Required: to mirror all app records into the Supabase table browser, open and run [supabase/demo_public_table_access.sql](supabase/demo_public_table_access.sql) for the current prototype. Without this step, Supabase will reject inserts with a row-level security error.

This creates the `public.app_state` table used by the current app. The full relational schema is available in [supabase/schema.sql](supabase/schema.sql) for the next backend migration step.

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

## 3. Current Security Note

The first sync step uses temporary demo policies on `public.app_state` so the static app can read and write while we wire real Supabase Auth.

Before production:

- Re-enable row-level security and replace demo access with authenticated role policies.
- Move login to Supabase Auth.
- Migrate app screens from `app_state` JSON sync to normalized tables.
- Add backup/export jobs.

## 4. Recommended Next Backend Step

After credentials are connected, migrate in this order:

1. Course Master and session templates
2. Teachers
3. Batches and hall bookings
4. Participants
5. Registrations and attendance
6. Accommodation
7. Certificates and history
