# Leegra Pulse — deploy to Netlify

One Netlify site serves both the app (frontend, incl. dashboard) and the
backend (serverless functions) — this is Netlify's normal model, so there's
a single deploy, not two separate services.

## What's here
- `src/` — the React PWA: login, field-rep app, client dashboard, super-admin, Leegra Learning.
- `netlify/functions/` — the backend: auth, dashboard summary, visits, learning-material storage.
- `netlify.toml` — build config + the `/api/*` → functions redirect.
- `public/logos/` — the real client logos (Philips, Sir Fruit, Civvio, Beurer, Bridgestone, Supa Quick, Hatfield Motor Group) and the Leegra mark.

## Deploy — fastest path (Netlify UI)
1. Push this `netlify-app/` folder to a GitHub repo (or drag-and-drop it as a zip into Netlify's "Deploy manually" screen).
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings are read from `netlify.toml` automatically — build command `npm run build`, publish `dist`, functions `netlify/functions`. No manual config needed.
4. Deploy. Netlify installs both `package.json`s (root + `netlify/functions/`) automatically.

## Deploy — from the terminal
```
cd netlify-app
npm install
npm install --prefix netlify/functions
netlify login
netlify init          # links this folder to a new or existing Netlify site
netlify deploy --prod
```

## Try it locally first
```
netlify dev
```
This runs the Vite frontend AND the functions together on one local URL, so `/api/*` calls work exactly like production — better than `npm run dev` alone once you're testing real login.

## Going from mock to real data
Right now `src/api.js` has `USE_MOCK = true`, so the frontend never calls the functions — everything (including logging in with any code) runs off `src/clients.js`. To switch on the real backend:
1. Set `USE_MOCK = false` in `src/api.js`.
2. Replace the in-memory data in `netlify/functions/_data.js` with a real database call — Netlify DB (managed Neon Postgres, provisioned with `netlify db init`) is the natural next step and keeps everything on Netlify; Supabase works too if you want Postgres + Storage + Row-Level-Security together.
3. Swap `netlify/functions/_lib/jwt.js`'s HMAC signing for the `jsonwebtoken` npm package and a real `JWT_SECRET` environment variable (Site settings → Environment variables).
4. `netlify/functions/learning-materials.js` already uses **Netlify Blobs** for file storage (ships with every site, no setup) — production just needs real multipart parsing on the upload path (Netlify Functions v2 request streaming, or the `parse-multipart-data` npm package).

## Multi-tenant isolation reminder
Every function resolves the tenant from the signed JWT (`jwt.fromAuthHeader`), never from a request body/query param — keep that pattern for any new endpoint you add, and see `BACKEND.md` (in the earlier handoff package) for the full data model and rules.
