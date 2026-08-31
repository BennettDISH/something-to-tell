# Something To Tell

Mutual secret exchange platform. Users join groups, submit secrets, and AI determines if two secrets are equivalent — if so, both are revealed (optionally obfuscated among AI-generated decoys).

## Architecture
- **Frontend**: React 19 + Vite + SCSS
- **Backend**: Express.js serving `/dist` in production
- **Database**: PostgreSQL (profiles, ai_configs, groups, group_members, secrets, vault_matches)
- **Auth**: SSO via central auth service + local JWT
- **AI**: User-provided API keys (Anthropic Claude / OpenAI GPT) for secret comparison and obfuscation generation

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — Production build
- `npm start` — Start Express server
- `npm run server` — Dev server with --watch

## Project Structure
```
server.js                 # Express entry point
config/db.js              # PostgreSQL pool + schema init
config/sso.js             # Central auth service helpers
middleware/auth.js         # JWT verification
services/aiService.js     # AI comparison + obfuscation generation
routes/auth.js            # SSO auth endpoints
routes/groups.js          # Group CRUD + join/leave
routes/secrets.js         # Secret submission + AI matching
routes/ai.js              # User AI config management
src/                      # React frontend
```

## Key Flows
1. User sets AI provider + API key in Settings
2. User creates/joins a group, shares join code
3. User seals a secret — content only, no per-secret options. The decoy count is a
   room rule (`room_config.deniability`, 0-10), set by the group admin in the room's
   intelligence rules, and applies to every reveal in that room.
4. Backend compares new secret against all others in group using submitter's AI key
5. If AI says match (confidence >= 0.6), vault opens — both secrets revealed, padded
   with AI-generated decoys when the room's `deniability` is > 0, shown directly when
   it is 0

Note: `secrets.obfuscation_level` is a vestigial column from the old per-secret design.
Submission always writes 0 and no read path consumes it — `routes/secrets.js` reads
`group.room_config.deniability` instead. Don't rewire it without reviving the UI too.

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Local JWT signing secret
- `ENCRYPTION_KEY` — enables AES-256-GCM at-rest encryption (`config/crypto.js`) for
  secrets.content, ai_configs.api_key, vault_matches.ai_reasoning/obfuscated_a/b, and
  comparisons.ai_reasoning/user_summary. Values carry an `enc:v1:` prefix; `initDb()`
  backfill-encrypts legacy plaintext rows idempotently at boot. Unset ⇒ plaintext +
  loud boot warning. No key rotation — changing it strands old rows (readable only as
  an `[encrypted — …]` marker). Encrypt on write in routes; decrypt at read choke
  points (`decryptFields`) — API response shapes are unchanged.
- `AUTH_SERVICE_URL` — Central auth service URL
- `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` — OAuth client credentials
- `VITE_AUTH_SERVICE_URL` / `VITE_SSO_CLIENT_ID` — Frontend SSO config

## Deployment
Railway auto-deploy on push to main. See `railway.toml`.
