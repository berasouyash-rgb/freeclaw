# Voice Box

Community problem-solving platform: posts, polls, suggestions, communities, AI assist, and an admin console — React 19 + Vite + TypeScript frontend, consolidated Vercel serverless API, optional FastAPI workforce runtime.

## Quick start

```powershell
npm install
cp .env.template .env        # fill in Supabase keys (required)
npm run dev                  # Vite + full-stack local API (plugins/api-dev.mjs)
```

`npm run dev` mounts `api/index.js` inside Vite, so `/api/*` works without `vercel dev`. Python workforce (optional): see `services/`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with local API |
| `npm run build` | `tsc -b && vite build` (also what Vercel runs) |
| `npm run typecheck` | `tsc -b --force` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit suite |
| `npm run test:api` | API route tests (`vitest.config.api.ts`) |

## Environment

Required: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server; fail-closed in production — see `api/_db-client.js`).
Optional AI providers: `NVIDIA_API_KEY` (primary), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`.
Email: `RESEND_API_KEY`, `EMAIL_FROM`. Workforce Python: `WORKFORCE_AI_URL` (defaults to `http://localhost:3000/api/ai`).

## Architecture

- `src/` — React app (`App.tsx` routes, `pages/`, `components/`, `lib/api.ts` fetch wrapper with offline queue)
- Boot — Direct Boot: the real app mounts on first paint; a static `#vb-splash` cover in `index.html` is removed by `main.tsx` once React is up (fatal boot errors render an inline error screen instead)
- `api/index.js` — single Vercel function; all `/api/*` rewritten here, handlers in `api/_*.js`
- `services/` — FastAPI workforce runtime (`services/main.py`, port 8000)
- `vercel.json` — rewrites, security headers, 2 daily cron jobs (`keep-alive`, `incident-cron?action=value-audit`; Hobby-plan max — agent/incident ticks run on demand from OpsCenter)

## Offline writes

Failed `POST/PUT/DELETE` replay from a local queue — except chat, reactions, inbox (non-replayable) and **never on timeout** (ambiguous outcome; would double-apply). See `src/lib/api.ts` + `src/lib/offline.ts`.

## Load model (100+ simultaneous users)

- Client: max 6 in-flight requests, rest wait FIFO (`src/lib/api.ts`); GET dedup + 5s cache; slow endpoints use `getSlow*` variants.
- Server: stateless Vercel function (autoscales); hot reads CDN-cached (`/api/leaderboard` 30s + SWR, `/api/categories` 60s); per-user rate limits.
- Python workforce: stateless FastAPI — scale with `uvicorn --workers N` behind the cron; task history is an in-memory ring (resets on deploy, by design).

## Real-agent runtime (NeMo Fabric)

`services/voicebox/fabric_bridge.py` runs tool-capable agents through NVIDIA NIM (`FABRIC_MODEL`, key from `NVIDIA_API_KEY`):

- `GET /api/workforce/fabric/status` — adapter plan + doctor (honest 503 without the package)
- `POST /api/workforce/fabric/run` — one invocation, normalized `{status, response, ...}` (502 on lifecycle failure, never retried server-side)

Install: `pip install "nemo-fabric[deepagents]"` (also in `services/requirements.txt`).
