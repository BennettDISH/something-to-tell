# something-to-tell

A mutual secret-exchange platform: people in a group submit secrets, and an AI layer handles matching
and obfuscation so exchanges stay mutual and anonymized. Secrets are encrypted at rest.

## Stack
React 19 + Vite · Express · Postgres · Anthropic SDK (AI matching) · SSO via `auth-service`

## Getting started
```bash
npm install
cp .env.example .env      # DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC key (see services/),
                          # AUTH_SERVICE_URL, SSO_CLIENT_ID/SECRET, VITE_AUTH_SERVICE_URL, VITE_SSO_CLIENT_ID

npm run server            # Express API (node --watch server.js)
npm run dev               # Vite dev server
```

Production: `npm run build` then `npm start`.

## Layout
- `src/pages/` — Dashboard, CreateGroup, GroupView, Settings, Admin, Login, Register, AuthCallback.
- `routes/` — `secrets.js`, `groups.js`, `ai.js`, `auth.js`, `admin.js`.
- `services/` — AI matching/obfuscation logic.

## Deploy
Railway.

## Notes
`ENCRYPTION_KEY` encrypts secrets at rest; AI matching uses the Anthropic API. Auth via `auth-service`
(SSO). See `../PORTFOLIO.md`.
