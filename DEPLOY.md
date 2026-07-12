# Leegra Pulse — app + dashboard (one codebase)

Both experiences ship from this single React app — the same login routes a
`field_rep` to the mobile check-in flow and a `client_manager`/`client_admin`
to the dashboard, based on the `role` returned at login. `chris@leegra.co.za`
gets a super-admin screen that can open any client's dashboard.

Currently wired to mock data in `src/clients.js` via `src/api.js` (`USE_MOCK
= true`) so it runs standalone. Flip that flag and point `VITE_API_BASE` at
your real backend (see `BACKEND.md`) once it exists — no other file needs to
change.

## Run locally
```
cd app
npm install
npm run dev
```
Open the printed localhost URL. On a phone on the same network, open your
computer's LAN IP instead — "Add to Home Screen" installs it as a PWA.

## Build for production
```
npm run build
```
Outputs a static `dist/` folder (HTML/CSS/JS + PWA manifest/service worker).

## Where to deploy

**Frontend (this app) — static hosting, pick one:**
- **Vercel** — `vercel` in the `app/` folder, or connect the GitHub repo; zero config for a Vite app.
- **Netlify** — drag-and-drop the `dist/` folder, or connect the repo (build command `npm run build`, publish dir `dist`).
- **Cloudflare Pages** — same idea, generous free tier, good if you'll also use Cloudflare Workers for the API.

Any of these gives you HTTPS + a URL immediately, which PWAs require (no HTTP install prompts).

**Backend (once you build it from `BACKEND.md`):**
- **Supabase** — Postgres + Auth + Storage + Row Level Security in one box; RLS policies keyed on `tenant_id` enforce client isolation at the database layer. Fastest path to a real multi-tenant backend for this app.
- **Render** or **Railway** — if you'd rather run a plain Node/Express API yourself against a managed Postgres.

Set `VITE_API_BASE` (in a `.env` file or your host's environment variables) to your deployed API's URL, and flip `USE_MOCK = false` in `src/api.js`.

## Files
- `src/App.jsx` — all three screens (login, field app, dashboard) + super-admin.
- `src/api.js` — the only file that talks to a backend; mock today, real fetch calls later.
- `src/clients.js` — demo tenant data (8 clients) standing in for the database.
- `src/theme.css` — Nocturne-derived design tokens as plain CSS variables.
- `public/logos/` — Philips and Sir Fruit logos; other tenants fall back to a text wordmark until real logos are uploaded.
