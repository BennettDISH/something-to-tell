# Something To Tell

Mutual secret exchange platform. Users join groups, submit secrets, and AI determines if two secrets are equivalent — if so, both are revealed (optionally obfuscated among AI-generated decoys).

## Architecture
- **Frontend**: React 19 + Vite + SCSS
- **Backend**: Express.js serving `/dist` in production
- **Database**: PostgreSQL (profiles, ai_configs, groups, group_members, secrets, vault_matches, comparisons); schema created in `initDb()` on boot
- **Auth**: SSO via central auth service + local JWT; email/password also goes through the auth service. Guests: no, because private secrets and AI keys (a guest who loses the browser can never see a match or come back): `routes/auth.js` answers 403 "Guest accounts can’t be used here. Sign in with your own account." for a Waypoint `is_guest` account at the SSO callback (and register/login) before a profile or token is made, `src/pages/AuthCallback.jsx` sends the reason to the sign-in page, and there is no guest route or button. There is no guest sweep; guest accounts that signed in before 2026-10-23 are still in the database.- **Live**: https://something-to-tell-production.up.railway.app
- **AI**: User-provided API keys (Anthropic Claude / OpenAI GPT) for secret comparison and obfuscation generation

Admin: /admin, Waypoint id 1 only (ADMIN_CENTRAL_USER_IDS=1). Files: `middleware/auth.js` (`isAdmin`, `authenticateAdmin`), `routes/admin.js` (`/api/admin/status`, `/groups`, `/groups/:id`; every route checks admin), `src/pages/Admin.jsx` (the page: status line, then every group with its members, secrets, comparison log and vaults; `/admin?group=ID` opens one), `src/components/ProtectedRoute.jsx` (sign-in redirect that comes back to the page, and the plain 403 view "This page is for the site admin."), `src/App.jsx` (the `/admin` route and the admin-only nav link), `src/pages/GroupView.jsx` (an admin-only "Open in admin" link). The session is a Bearer token in localStorage, so the server cannot tell who asks for the page itself: the page is the same app shell for everyone and ships no data; the 403 view is client-side and `/api/admin/*` is 403 on its own. Users' saved AI keys (`ai_configs`) are never read by an admin route and never shown; `test/admin.test.js` pins that. The old "Deep Intel" panel on a group page (`/api/secrets/group/:id/admin/logs`) is gone: the same content is on /admin.

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — Production build
- `npm start` — Start Express server
- `npm run server` — Dev server with --watch

- `npm test` — `test/api.test.js` (auth, groups, secrets and AI keys encrypted at rest, a full comparison
  that opens a vault), `test/privacy.test.js` (what runs, vaults and leavers expose to other members),
  `test/admin.test.js` (the /admin gate, no AI key in any admin answer), `test/return-path.test.js` (sign-in comes back to the page asked for),
  `test/health.test.js` (the health route, with a failing database), `test/a11y.test.js` (page language, zoomable viewport, one `<main>`),
  `test/limits.test.js` (secret size and submit caps), `test/sign-in-limits.test.js` (per-IP login
  limits; Waypoint caps its proxy routes per calling address, this server's), `test/sso.test.js` (guests
  refused), `test/backfill.test.js` (plaintext rows encrypted
  at the next boot) and `test/encryption-key.test.js` (a missing or wrong key). `test/helpers.js`
  spawns the real `server.js` against PGlite on the Postgres wire protocol, with stand-in Waypoint (code exchange; it can also send a guest, to prove the app refuses one) and OpenAI (via `OPENAI_BASE_URL`). PGlite runs one transaction at a time.

Plans and known issues go in `docs/ROADMAP.md`.

## Project Structure
```
server.js                 # Express entry point
config/db.js              # PostgreSQL pool + schema init + encryption backfill
config/crypto.js          # AES-256-GCM helpers (enc:v1: values, decryptFields)
config/sso.js             # Central auth service helpers
middleware/auth.js        # JWT verification; authenticateAdmin (ADMIN_CENTRAL_USER_IDS)
middleware/rateLimit.js   # Per-IP limiter on sign-in: 10 logins/15 min, then 429
services/aiService.js     # AI comparison + obfuscation generation
services/summaries.js     # Fixed comparison summaries members read (never AI-written)
routes/auth.js            # SSO callback, register, login (all refuse guests), profile
routes/groups.js          # Group CRUD + join/leave
routes/health.js          # GET /health: SELECT 1 with a 3 s limit; 200, or 503 without database text; no-store
routes/secrets.js         # Secret submission, admin-run comparison, admin logs
routes/ai.js              # User AI config management
routes/admin.js           # Site admin (/admin): status line, all groups with their secrets and logs
src/                      # React frontend (App.jsx wraps the routed page in one `<main id="main">`; `test/a11y.test.js` checks it)
```

## Key Flows
1. Room admin sets AI provider + API key in Settings — only the admin's key is ever used
2. User creates/joins a group, shares join code. New codes are 16 hex characters; rooms
   from before have 8-character codes, which still work. Ten wrong codes from one client IP
   within 15 minutes shut that IP out of joining (429) until the window ends — in-process,
   and it relies on `trust proxy` (one hop, Railway's) in `server.js` for real client IPs.
3. User writes a secret (SEAL SECRET) — content only, no per-secret options; it is
   stored `sealed` and no AI call is made on write. The decoy count is a room rule
   (`room_config.deniability`, 0-10), set by the group admin in the room's
   intelligence rules, and applies to every reveal in that room.
4. User marks it SUBMIT when ready (`sealed` → `submitted`); UNSUBMIT puts it back.
   Secrets are capped at 2000 characters and 10 submitted per member per room (they cost
   the room admin's AI key).
5. Room admin hits RUN COMPARISON (`POST /api/secrets/group/:groupId/compare`, 403 for
   non-admins) — the backend compares every cross-member pair of submitted secrets using
   the **admin's** AI key, not the submitters'. Only current members' secrets take part;
   someone who left keeps theirs out. The response carries counts and match ids only.
6. If AI says match (confidence >= 0.6), vault opens — both secrets revealed, padded
   with AI-generated decoys when the room's `deniability` is above 0, shown directly
   when it is 0. The AI's raw reasoning quotes both secrets, so a vault with decoys
   shows the pair's `user_summary` as its "AI Consensus" instead. If the AI
   gives back no usable decoys, no vault opens and the pair is retried next run.
7. Every `user_summary` members read is a fixed sentence from `services/summaries.js`,
   picked from the outcome and the room's strategy; the AI is not asked for one. Room
   admins' free-text rules go into the comparison prompt as instructions, so any text
   the AI wrote for members could be steered into paraphrasing a secret. Older AI-written
   summaries are swapped for the fixed one at read time, and members never get the AI's
   confidence number. The reasoning stays for the site admin and no-decoy vaults.

Note: `secrets.obfuscation_level` was a vestigial column from the old per-secret
design. Its plumbing has been removed: fresh installs no longer create the column and
no code writes or reads it — `routes/secrets.js` reads `group.room_config.deniability`
instead. Existing databases may still carry the column (nullable with a default);
nothing consumes it.

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Local JWT signing secret
- `ENCRYPTION_KEY` — enables AES-256-GCM at-rest encryption (`config/crypto.js`) for
  secrets.content, ai_configs.api_key, vault_matches.ai_reasoning/obfuscated_a/b, and
  comparisons.ai_reasoning/user_summary. Values carry an `enc:v1:` prefix; `initDb()`
  backfill-encrypts legacy plaintext rows idempotently at boot. Unset ⇒ in production,
  saving a secret, an AI key or running a comparison returns 503 (`middleware/encryption.js`);
  elsewhere plaintext. Either way a loud boot warning. Before the backfill, `initDb()` also
  counts stored ciphertext the current key cannot decrypt and logs it loudly. No key rotation — changing it strands old rows (readable only as
  an `[encrypted — …]` marker). Encrypt on write in routes; decrypt at read choke
  points (`decryptFields`) — API response shapes are unchanged.
- `AUTH_SERVICE_URL` — Central auth service URL
- `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` — OAuth client credentials
- `VITE_AUTH_SERVICE_URL` / `VITE_SSO_CLIENT_ID` — Frontend SSO config (read in `src/services/authService.js`, baked in at build time)
- `ADMIN_CENTRAL_USER_IDS` — central user ids allowed on /admin, exactly `1` on the live service (unset means nobody)
- `PORT`, `NODE_ENV`

## Deployment
Railway auto-deploys on push to main. Build and start commands, the restart policy and the healthcheck path are set on the Railway service itself; there is no `railway.toml`. `/health` (`routes/health.js`) is `SELECT 1` with a 3 second limit: 200 `{ status: 'ok', db: 'ok' }` or 503 `{ status: 'unavailable', db: 'not answering' }`, never any database text (`healthHandler({ query, timeoutMs })` takes a stand-in query for `test/health.test.js`).
