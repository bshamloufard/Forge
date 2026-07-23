# Forge

Forge is an MVP post-training control plane inspired by Thinking Machines'
Tinker product surface. The intended MVP stack is:

- Next.js for the web UI and API surface
- Render for the hosted control plane
- Supabase for Postgres, Auth, Storage, and Realtime state
- Modal for training jobs, samplers, sandboxes, and batch eval workers
- Baseten as the first OpenAI-compatible serving target

See [plan.md](plan.md) for the product and architecture plan.

## Local Setup

The application source is expected to provide standard Next.js scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p ${PORT:-3000}"
  }
}
```

Then run:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Runtime Contract

Implementation agents should make the app satisfy these deployment assumptions:

- `GET /api/health` returns a 2xx response for Render health checks.
- The server binds to `0.0.0.0` and `PORT`.
- No secret with provider, database, or service-role privileges is exposed through a
  `NEXT_PUBLIC_` variable.
- Browser Supabase access uses only
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Server-only Supabase access uses `SUPABASE_SECRET_KEY` or
  `SUPABASE_SERVICE_ROLE_KEY`.

## Deploy

Render deployment is defined in [render.yaml](render.yaml). Use the Blueprint flow
from the Render dashboard after the repository is pushed to GitHub.

1. Create a Supabase project and collect the project URL, publishable key, secret
   key, and pooled Postgres connection string.
2. Create a Modal service-user token and collect `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET`.
3. Create a Baseten API key. For the temporary MVP, use Baseten Model APIs with
   `BASETEN_BASE_URL=https://inference.baseten.co/v1`.
4. In Render, create a new Blueprint from this repository.
5. Fill every `sync: false` environment variable when Render prompts for secrets.
6. Deploy and verify:

```bash
curl -fsS https://<render-service>.onrender.com/api/health
```

For a fuller runbook, see [docs/deployment.md](docs/deployment.md).
