# Onboarding, testing, and getting to the app stores

## 1. The Claude-side design/code
The live, editable version of Leegra Pulse is **`Leegra Pulse.dc.html`**, open in your Claude preview tab right now — that's the design/code artifact this whole conversation has been building and is the one to keep iterating on here (colors, copy, new screens, new client logos). It runs standalone in any browser.

The **`netlify-app/`** download is the separate, deployable version of the same product (React + serverless backend) for when you're ready to put it on the internet for real users — see below.

## 2. Loading a client's store base
1. Give the client (or fill in yourself) `templates/stores-template.csv` — one row per store/branch.
2. Convert the filled CSV to the JSON shape `admin-stores-import.js` expects (`{ tenant_code, rows: [...] }`) — any spreadsheet's "export as JSON" plugin works, or ask Claude Code to write a 5-line converter script once you're in a real dev environment.
3. `POST /api/admin-stores-import` with a super-admin or that client's admin token. The tenant's full store list is now loaded — reps and managers see it immediately on next login.

## 3. Setting up visit questionnaires
Reps no longer fill in a fixed 4-task checklist — each tenant defines its own questions per visit, and different questionnaires can apply to different stores or visit types.
1. Fill in `templates/questionnaire-template.csv` — one row per question, grouped by a shared `questionnaire_name`. `question_type` is one of `boolean`, `number`, `text`, `choice` (semicolon-separate `options` for `choice`, e.g. `Good;Fair;Poor`). Leave `store_codes` blank and `visit_type` blank for a tenant-wide default; fill either in to scope a questionnaire more narrowly (semicolon-separate multiple `store_codes`).
2. Group the CSV rows by `questionnaire_name` into this JSON shape, one `POST /api/admin-questionnaire-import` call per questionnaire:
   `{ tenant_code, name, store_codes: [...], visit_type, questions: [{ label, type, options, required }, ...] }`
3. At check-in, the app picks the most specific match for the rep's store (and visit type, if you're using that field) — falling back to the tenant-wide default if nothing more specific applies. If nothing matches at all, the rep sees no checklist for that visit.
4. Re-POST with the same `name` (or pass back the `id` returned from the first call) to update a questionnaire later rather than creating a duplicate.

## 4. Assigning users to stores
1. `POST /api/admin-users-assign` with `{ email, role, store_codes: [...] }` for each staff member — `field_rep` should list only the stores that person covers; `client_manager`/`client_admin` don't need a list (they see the whole tenant).
2. Re-running this for the same email updates their assignment — use it whenever a rep's route changes.
3. This assignment list is exactly what scopes a rep's `/my/stores` view — nothing outside it is ever returned to their session.

## 5. Backfilling the last 3 months of data
1. Fill in `templates/visits-history-template.csv` from whatever system/spreadsheet you're tracking visits in today — one row per past visit.
2. Convert to JSON and `POST /api/admin-visits-import` in batches of a few hundred rows (`{ tenant_code, rows: [...] }`).
3. Do this per tenant, after that tenant's store base is loaded (step 2) so `store_code` values resolve. Once imported, the dashboard's compliance %, trend and leaderboard reflect real history instead of starting from zero.

## 6. Deploying to Netlify
See `DEPLOY_NETLIFY.md` for the full steps — in short: push `netlify-app/` to a repo, "Import an existing project" in Netlify, it builds itself from `netlify.toml`. One URL serves the whole product.

## 7. Testing the PWA with real users
1. Share the deployed Netlify URL directly — no app store needed for this stage.
2. **Android (Chrome)**: visiting the URL shows Chrome's own install prompt, or users tap the menu → "Add to Home screen/Install app". It installs like a native app icon.
3. **iOS (Safari)**: Safari's Share button → "Add to Home Screen". iOS doesn't show an automatic install banner — this is a manual step you'll want to tell testers about explicitly.
4. Have a handful of real reps use it for a week on their own phones (check-in/out, questionnaire, Leegra Learning) before wider rollout — this is the cheapest way to catch UX issues before committing to app-store packaging.

## 8. Next step once it's proven: Apple App Store & Google Play
A PWA can be wrapped for both stores without a full rewrite:
- **Google Play**: package the deployed PWA as a **Trusted Web Activity** using **[PWABuilder](https://www.pwabuilder.com)** or **Bubblewrap** — point it at your Netlify URL, it generates a signed Android App Bundle ready to upload to Play Console. Fastest path, and it stays in sync with the live site (updates ship by just updating the website in most cases).
- **Apple App Store**: Apple doesn't accept a bare TWA-equivalent, so wrap with **[Capacitor](https://capacitorjs.com)** (loads your deployed site in a native WebView shell) or use PWABuilder's iOS package output, then submit through Xcode/App Store Connect the normal way. Push notifications and camera/GPS access work through Capacitor's native plugins if the plain web APIs aren't enough on iOS.
- Either route reuses the exact same deployed Netlify app — you are not rebuilding the product, just adding a thin native wrapper once the web version is stable and tested.
