# something-to-tell

A mutual secret-exchange platform: people in a group submit secrets, and an AI layer handles matching
and obfuscation so exchanges stay mutual and anonymized. Secrets, users' AI API keys, and AI text that
quotes secrets are encrypted at rest (AES-256-GCM) **when `ENCRYPTION_KEY` is set** — without it,
production refuses to save them (503) and other environments store plaintext, with a loud warning at
boot either way. Boot also warns when the key cannot decrypt rows already stored.

Live: https://something-to-tell-production.up.railway.app

Admin: `/admin` (every group, its secrets and comparison log; never anyone's AI key), Waypoint id 1 only (`ADMIN_CENTRAL_USER_IDS=1`).

## Stack
React 19 + Vite · Express · Postgres · Anthropic + OpenAI SDKs (AI matching) · SSO via `auth-service`

## Getting started
```bash
npm install
cp .env.example .env      # DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, AUTH_SERVICE_URL,
                          # SSO_CLIENT_ID/SECRET, VITE_AUTH_SERVICE_URL, VITE_SSO_CLIENT_ID
                          # No AI key goes here — each user saves their own in Settings.

npm run server            # Express API (node --watch server.js)
npm run dev               # Vite dev server
```

Production: `npm run build` then `npm start`.

## Test
`npm test` runs the tests in `test/`: the real `server.js` against an in-memory Postgres (PGlite) with
encryption on, plus stand-ins for the auth service and OpenAI, so no database, keys or network are needed.

## Environment variables
- `DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`
- `ENCRYPTION_KEY` (turns on encryption at rest; see Notes before changing it)
- `AUTH_SERVICE_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` (server); `VITE_AUTH_SERVICE_URL`,
  `VITE_SSO_CLIENT_ID` (baked into the client build)
- `ADMIN_CENTRAL_USER_IDS` (central user ids who can open `/admin`: exactly `1` on the live service; unset means nobody)

Guests are not allowed: Waypoint's sign-in page offers "Continue as guest", and the app answers
that with a 403 ("Guest accounts can’t be used here. Sign in with your own account.") before any
profile or token is made.

## Layout
- `src/pages/` — Dashboard, CreateGroup, GroupView, Settings, Admin, Login, Register, AuthCallback.
- `routes/` — `secrets.js`, `groups.js`, `ai.js`, `auth.js`, `admin.js`, `health.js` (the `/health` handler).
- `services/` — AI matching/obfuscation logic.
- `config/crypto.js` — at-rest encryption helpers.
- `docs/ROADMAP.md` — ideas and known issues.

## Deploy
Railway, auto-deploys `main`. The build and deploy settings live on the Railway service itself
(there is no `railway.toml`): Nixpacks builds with `npm install && npm run build`, starts
`node server.js` and restarts on failure up to 10 times.

`GET /health` is the healthcheck: it runs one `SELECT 1` (3 second limit) and answers
`200 {"status":"ok","db":"ok"}`, or `503 {"status":"unavailable","db":"not answering"}` with no
database text when the database errors or stays silent. It is never cached.

## Notes
`ENCRYPTION_KEY` (any strong string) encrypts secrets/API keys/AI text at rest via `config/crypto.js`
(`enc:v1:` prefix; legacy plaintext rows are backfill-encrypted automatically at the next boot after the
key is set). During that first redeploy an old replica may still be serving without the key, so a few
requests can briefly show `[encrypted — …]` in place of content; it resolves as soon as cutover finishes. No key rotation: changing the key makes old rows unreadable (they render as an
`[encrypted — …]` marker, never a crash). AI credentials are per-user, not environment variables: each
user saves their own Anthropic or OpenAI key in **Settings** (stored in `ai_configs`, read through
`getUserAiConfig` in `services/aiService.js`). Auth via `auth-service`
(SSO).
