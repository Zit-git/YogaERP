# Aliyar Programs Deployment

This version is a static web app. It can be hosted on Netlify, Vercel, GitHub Pages, S3, or any ordinary web server.

## Current Scope

- Files to deploy: `index.html`, `app.js`, `styles.css`
- Public registration works without login.
- Role-based login is currently demo/local-browser login.
- Records are stored in browser `localStorage`.

For real production use with multiple users, the next step is to add a backend API, database, and server-side authentication.

## Fastest Deployment Options

### Netlify

1. Create a new Netlify site.
2. Drag this folder, or the deployment ZIP, into Netlify.
3. Publish directory: `.`
4. Build command: leave empty.

### Vercel

1. Create a new Vercel project.
2. Import this folder/repository.
3. Framework preset: Other.
4. Build command: leave empty.
5. Output directory: `.`

### GitHub Pages

1. Push these files to a GitHub repository.
2. Enable Pages from the repository settings.
3. Source: deploy from branch.
4. Folder: root.

## Demo Login

- Admin: `admin`
- Participant: `p1` or `9876500011`
- Teacher: `t1` or `meenakshi@example.com`

Passwords are not enforced in this static prototype.

## Production Follow-Up

Before using this for real operations:

- Move data from `localStorage` to a database.
- Replace demo login with secure authentication.
- Enforce permissions on the server.
- Add backup/export workflows.
- Add deployment environment separation for UAT and Production.
