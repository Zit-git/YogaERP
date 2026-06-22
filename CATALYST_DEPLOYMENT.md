# Zoho Catalyst Slate Deployment

This app is a static frontend, so it can be hosted on Catalyst Slate.

## One-time Catalyst console step

1. Open your Catalyst project.
2. Go to **Slate** in the left sidebar.
3. Click **Start Exploring**.

This activates Slate for the project. Without this, the CLI can fail with no deploy target.

## One-time local CLI setup

From this project folder:

```bash
catalyst login
catalyst init
```

During init, select the correct Catalyst project. If the CLI asks for features, choose Slate/frontend hosting.

## Deploy

```bash
catalyst deploy slate -m "Deploy Aliyar Programs"
```

For production deployment after testing:

```bash
catalyst deploy slate --production -m "Production deploy Aliyar Programs"
```

## Notes

- The app continues to use Supabase for database and login.
- Keep `supabase-config.js` updated before deployment.
- If you change project folder location, update the absolute `source` path in `catalyst.json`.
