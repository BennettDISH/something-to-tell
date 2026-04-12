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
3. User submits a secret with obfuscation level (0-10 decoys)
4. Backend compares new secret against all others in group using submitter's AI key
5. If AI says match (confidence >= 0.6), vault opens — both secrets revealed with obfuscation

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Local JWT signing secret
- `AUTH_SERVICE_URL` — Central auth service URL
- `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` — OAuth client credentials
- `VITE_AUTH_SERVICE_URL` / `VITE_SSO_CLIENT_ID` — Frontend SSO config

## Deployment
Railway auto-deploy on push to main. See `railway.toml`.
