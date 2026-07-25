# Forge

Forge is an MVP post-training control plane inspired by Thinking Machines'
Tinker product surface. The intended MVP stack is:

- Python/FastAPI for the customer API, SDK-compatible primitives, provider
  orchestration, and product writes
- Next.js for the web UI and temporary backend-for-frontend proxy routes
- Render for the hosted control plane
- Supabase for Postgres, Auth, Storage, and Realtime state
- Modal for training jobs, samplers, sandboxes, and batch eval workers
- Baseten as the first OpenAI-compatible serving target

Developers can register training data from a public Hugging Face dataset or upload
JSONL, JSON, or CSV data in the dashboard. Forge validates the schema, adds a
reusable adapter, stores uploads privately, and pins the chosen dataset to each run.
See [docs/datasets.md](docs/datasets.md) for the API, adapter contract, limits, and
research rationale.

See [plan.md](plan.md) for the product and architecture plan. See
[docs/python-backend-handoff.md](docs/python-backend-handoff.md) for the
handoff that explains the Python backend migration and next implementation
slice.

## Local Setup

Run the Python API and the Next.js dashboard in separate terminals:

```bash
cp .env.example .env.local
npm install
python -m pip install -e apps/api -e packages/forge

npm run api:dev
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 API_INTERNAL_BASE_URL=http://localhost:8000 npm run dev
```

Open `http://localhost:3000`.

The Python API is also directly available at `http://localhost:8000`:

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/v1/capabilities
```

## Python SDK

The local SDK lives in [packages/forge](packages/forge). It exposes a
Tinker-like client surface:

```python
from forge import ServiceClient

service = ServiceClient(base_url="http://localhost:8000")
training = service.create_training_client(model="sshleifer/tiny-gpt2", recipe="chat-sft")
training.forward_backward(microbatches=2)
training.optim_step()
checkpoint = training.save_state(name="local-step")
sampling = training.save_weights_and_get_sampling_client()
print(sampling.sample(prompt="Explain checkpoint lineage.").output)
```

Run API tests with `npm run api:test`. With the API server running, run
`npm run smoke:python` for the SDK smoke flow.

## Required Runtime Contract

Implementation agents should make the app satisfy these deployment assumptions:

- `GET /health` returns a 2xx response for the Python API Render health check.
- `GET /api/health` remains a Next.js compatibility proxy to the Python API.
- The server binds to `0.0.0.0` and `PORT`.
- No secret with provider, database, or service-role privileges is exposed through a
  `NEXT_PUBLIC_` variable.
- Browser calls use only `NEXT_PUBLIC_API_BASE_URL`; server-side Next proxy calls
  use Render's private network via `API_INTERNAL_HOSTPORT` in production, with
  `API_INTERNAL_BASE_URL` retained as a local-development fallback.
- Browser Supabase access uses only
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Server-only Supabase access uses `SUPABASE_SECRET_KEY` or
  `SUPABASE_SERVICE_ROLE_KEY`.

## Deploy

Render deployment is defined in [render.yaml](render.yaml). It creates
`forge-api` for FastAPI and `forge-web` for the dashboard. Use the Blueprint
flow from the Render dashboard after the repository is pushed to GitHub.

1. Create a Supabase project and collect the project URL, publishable key, secret
   key, and pooled Postgres connection string.
2. Create a Modal service-user token and collect `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET`.
3. Create a Baseten API key. For the temporary MVP, use Baseten Model APIs with
   `BASETEN_BASE_URL=https://inference.baseten.co/v1`.
4. In Render, create a new Blueprint from this repository.
5. Fill every `sync: false` environment variable when Render prompts for secrets.
   Render derives `API_INTERNAL_HOSTPORT` from `forge-api` automatically.
6. Deploy and verify:

```bash
curl -fsS https://<forge-api>.onrender.com/health
curl -fsS https://<forge-web>.onrender.com/api/health
```

For a fuller runbook, see [docs/deployment.md](docs/deployment.md).
