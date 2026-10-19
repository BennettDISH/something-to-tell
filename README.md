# something-to-tell

A mutual secret-exchange platform: people in a group submit secrets, and an AI layer handles matching
and obfuscation so exchanges stay mutual and anonymized. Secrets, users' AI API keys, and AI text that
quotes secrets are encrypted at rest (AES-256-GCM) **when `ENCRYPTION_KEY` is set** — without it the
server stores plaintext and warns loudly at boot.

Live: https://something-to-tell-production.up.railway.app

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
No automated tests yet.

## Environment variables
- `DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`
- `ENCRYPTION_KEY` (turns on encryption at rest; see Notes before changing it)
- `AUTH_SERVICE_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` (server); `VITE_AUTH_SERVICE_URL`,
  `VITE_SSO_CLIENT_ID` (baked into the client build)
- `ADMIN_CENTRAL_USER_IDS` (comma-separated central user ids who can open the site admin page)

## Layout
- `src/pages/` — Dashboard, CreateGroup, GroupView, Settings, Admin, Login, Register, AuthCallback.
- `routes/` — `secrets.js`, `groups.js`, `ai.js`, `auth.js`, `admin.js`.
- `services/` — AI matching/obfuscation logic.
- `config/crypto.js` — at-rest encryption helpers.
- `docs/ROADMAP.md` — ideas and known issues.

## Deploy
Railway, auto-deploys `main`. Build `npm install && npm run build`, start `node server.js`
(`railway.toml`). Health check: `/health`.

## Notes
`ENCRYPTION_KEY` (any strong string) encrypts secrets/API keys/AI text at rest via `config/crypto.js`
(`enc:v1:` prefix; legacy plaintext rows are backfill-encrypted automatically at the next boot after the
key is set). During that first redeploy an old replica may still be serving without the key, so a few
requests can briefly show `[encrypted — …]` in place of content; it resolves as soon as cutover finishes. No key rotation: changing the key makes old rows unreadable (they render as an
`[encrypted — …]` marker, never a crash). AI credentials are per-user, not environment variables: each
user saves their own Anthropic or OpenAI key in **Settings** (stored in `ai_configs`, read through
`getUserAiConfig` in `services/aiService.js`). Auth via `auth-service`
(SSO).
