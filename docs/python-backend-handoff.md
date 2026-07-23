# Python Backend Handoff

Current date: July 23, 2026

This handoff captures the state of the Forge MVP and the next feature change:
move the customer-facing backend, analytics, persistence, and provider
orchestration into Python. The existing Next.js app should remain the dashboard
and can temporarily proxy API calls, but it should no longer be the product
backend.

## Why This Change Exists

The current repo is mostly TypeScript because the first MVP was built as a
Next.js full-stack control plane. That produced a deployable demo quickly, but
it does not match the product we are cloning closely enough.

Public Tinker evidence points to this split:

- `thinking-machines-lab/tinker` is described as the Tinker Python SDK.
- Tinker quickstart installs with `uv pip install tinker` and uses
  `import tinker`.
- The Tinker cookbook is Python-based and uses Python notebooks/scripts.
- Thinking Machines job listings describe Tinker backend services and APIs as
  Python/Rust, with React/TypeScript for user-facing UI surfaces.

The corrected Forge split should be:

- Python: customer API, SDK-compatible training/sampling primitives, analytics,
  persistence, provider adapters, job orchestration.
- TypeScript/React: dashboard, status views, run controls, charts, and a thin
  backend-for-frontend proxy only where useful.
- Rust: optional future path for hot services, schedulers, or low-level runtime
  pieces. Do not block the MVP on Rust.

Sources checked:

- https://github.com/thinking-machines-lab/tinker
- https://tinker-docs.thinkingmachines.ai/tinker/quickstart/
- https://github.com/thinking-machines-lab/tinker-cookbook
- https://builtin.com/job/software-engineer-full-stack-tinker/10045254
- https://www.tealhq.com/job/software-engineer-full-stack_7ea1a24806b966055fd74495720928d436995

## What We Have Done

The current deployed MVP is a working mock-provider control plane.

Production URL:

- https://forge-tinkering-mvp.onrender.com

Render service:

- Name: `forge-tinkering-mvp`
- Service ID: `srv-d9h4fternols73el6ti0`
- Latest known deployed commit: `702acff`

Recent commits:

- `702acff` Retry Render edge misses in MVP flows
- `52bd8f5` Use stable v1 API routes in UI smoke
- `3861574` Use free Render plan for MVP deploy
- `f05d91f` Build Tinkering MVP control plane

Implemented local files:

- `app/page.tsx`: dashboard for sessions, runs, checkpoints, verifier scores,
  deployment state, and provider health.
- `app/api/**`: legacy mock API routes.
- `app/api/v1/**`: stable API route surface for projects, sessions, runs,
  training steps, sampling jobs, checkpoints, deployments, and verifier calls.
- `lib/store.ts`: mock/file-backed state persisted under `.forge/state.json`.
- `lib/providers.ts`: environment-aware Modal/Baseten/Supabase provider health.
- `lib/verifier.ts`: heuristic verifier scoring, ranking, trajectory scoring,
  progress, and reward shaping.
- `lib/types.ts`: shared TypeScript domain types.
- `supabase/schema.sql`: initial Supabase schema and RLS bootstrap.
- `scripts/smoke.mjs`: local/remote smoke test.
- `render.yaml`: Render Blueprint for the Next.js service.
- `README.md` and `docs/deployment.md`: setup and deploy runbooks.

Verified:

- `npm run build`
- `npm run smoke`
- `SMOKE_BASE_URL=https://forge-tinkering-mvp.onrender.com npm run smoke`
- `npm audit --omit=dev --audit-level=high`

Known deployed behavior:

- The UI can create and mutate mock sessions/runs/checkpoints/deployments.
- The v1 API routes are callable.
- Provider health flips from `mock` to `configured` based on env vars.
- No real training, sampling, checkpoint export, billing, analytics, auth, or
  durable database persistence is active yet.

## Current Gaps

These are not polish issues; they are product-boundary gaps.

- The customer API is implemented as Next.js route handlers, not a Python
  service or Python SDK-compatible backend.
- The TypeScript API routes mutate local file-backed state, not Supabase.
- Supabase schema exists but is not wired into runtime code.
- There is no customer auth, API-key auth, tenant enforcement, usage accounting,
  billing events, or analytics event pipeline.
- Modal and Baseten are only represented as provider health/configuration
  checks; no real provider job invocation exists.
- Verifier logic is a local heuristic, not a model-backed verifier service.
- Checkpoints are mock records, not real LoRA adapter artifacts in object
  storage.
- The current Render deployment is one Node service; the corrected architecture
  needs at least a Python API service plus the Next.js UI service.

## Target Architecture

```text
Python SDK / customer code
        |
        v
FastAPI customer API on Render
        |
        +-- Supabase Postgres: tenants, projects, sessions, runs, analytics
        +-- Supabase Storage: datasets, logs, checkpoints, exports
        +-- Modal: training workers, sampling jobs, Harbor sandboxes, evals
        +-- Baseten: optional deployment target for exported checkpoints
        +-- Next.js dashboard: calls Python API, displays state and analytics
```

The Python API should be the system of record. Next.js should consume it like
any other customer would.

## Proposed Repository Shape

Keep the existing app while introducing a Python workspace:

```text
apps/
  api/
    pyproject.toml
    forge_api/
      main.py
      settings.py
      auth.py
      database.py
      analytics.py
      routers/
        health.py
        projects.py
        sessions.py
        training.py
        sampling.py
        checkpoints.py
        deployments.py
        verifier.py
      services/
        training_runs.py
        sampling_jobs.py
        checkpoints.py
        deployments.py
        usage.py
      providers/
        modal_client.py
        baseten_client.py
        verifier_client.py
      models/
        domain.py
        requests.py
        responses.py
  web/
    app/
    lib/
packages/
  forge/
    pyproject.toml
    forge/
      __init__.py
      service_client.py
      training_client.py
      sampling_client.py
      verifier_client.py
      types.py
workers/
  modal/
    pyproject.toml
    forge_modal/
      app.py
      training.py
      sampling.py
      sandbox.py
      artifacts.py
supabase/
  migrations/
docs/
  python-backend-handoff.md
```

If moving the existing Next.js files into `apps/web` is too much churn for the
first pass, leave them at repo root temporarily and add `apps/api`,
`packages/forge`, and `workers/modal` first.

## Python API Contract

The first Python service should preserve the v1 route surface already used by
the dashboard and smoke tests:

- `GET /health`
- `GET /v1/capabilities`
- `GET /v1/projects`
- `POST /v1/sessions`
- `GET /v1/sessions`
- `GET /v1/runs`
- `POST /v1/training-runs/{run_id}/forward-backward`
- `POST /v1/training-runs/{run_id}/optim-step`
- `POST /v1/sampling-jobs`
- `GET /v1/checkpoints`
- `POST /v1/checkpoints`
- `POST /v1/deployments`
- `POST /v1/deployments/{deployment_id}/invoke`
- `POST /v1/verifier/verify`
- `POST /v1/verifier/rank`
- `POST /v1/verifier/score`
- `POST /v1/verifier/score-trajectory`
- `POST /v1/verifier/progress`
- `POST /v1/verifier/reward`

The public Python SDK should wrap that API with Tinker-like clients:

```python
from forge import ServiceClient

service = ServiceClient(api_key="...")
training = service.create_training_client(
    project_id="...",
    model="qwen3-8b",
    recipe="chat-sft",
)

training.forward_backward(batch)
training.optim_step()
checkpoint = training.save_state(name="sft-step-100")

sampling = service.create_sampling_client(checkpoint_id=checkpoint.id)
completion = sampling.sample(prompt="...")
```

## Data And Analytics Requirements

Move from mock state to Supabase-backed records. The API should write normal
domain tables plus append-only analytics events.

Core tables:

- `organizations`
- `organization_members`
- `projects`
- `api_keys`
- `sessions`
- `training_runs`
- `sampling_jobs`
- `checkpoints`
- `deployments`
- `verifier_scores`
- `provider_jobs`
- `artifacts`

Analytics/event tables:

- `usage_events`: token counts, GPU seconds, provider cost, customer-visible
  cost, run/session/project IDs.
- `api_events`: route, method, status, latency, auth subject, project ID.
- `job_events`: queued, started, retried, completed, failed, cancelled.
- `model_events`: sample count, prompt tokens, completion tokens, verifier
  scores, checkpoint source.
- `billing_ledger`: immutable billable usage rows derived from usage events.

Minimum analytics views:

- Usage by organization, project, session, run, model, provider, and day.
- Cost by provider versus customer-facing billable amount.
- Run funnel: queued -> running -> checkpointed -> deployed.
- Error rate and p95 latency by route and provider.

## Provider Implementation Order

1. Supabase persistence

   Replace `.forge/state.json` with repository/service methods backed by
   Supabase Postgres. Preserve the current mock store behind a local development
   flag only if it speeds up tests.

2. Python API-key auth

   Add hashed customer API keys scoped to organization/project. Enforce tenant
   checks on every route before wiring real provider calls.

3. Modal worker boundary

   Add a real Modal app for training, sampling, eval, and sandbox jobs. The
   Python API should enqueue/invoke jobs and persist provider job IDs, status,
   retries, logs, and artifacts.

4. Checkpoint artifacts

   Store LoRA adapter metadata in Postgres and artifacts in Supabase Storage.
   Start with small generated placeholder artifacts if real training is not
   ready, but keep the artifact contract real.

5. Baseten deployment adapter

   Convert a completed checkpoint into a deployable target record. For the first
   pass, support configured Baseten endpoints and invocation. Automating model
   build/deploy can follow after the checkpoint artifact path is stable.

6. Verifier service

   Keep the current API shape, but move scoring into Python. Start with a
   pluggable provider interface so heuristic scoring, hosted model scoring, and
   future repeated/criteria-decomposed verification can coexist.

7. Dashboard cutover

   Point `app/page.tsx` at the Python API. Next.js route handlers may stay as
   proxies temporarily, but the Python API must own validation, auth, writes,
   analytics, and provider orchestration.

## Render Deployment Plan

The deployment should become two Render web services:

- `forge-api`: Python FastAPI service.
- `forge-web`: Next.js dashboard.

Required `forge-api` environment variables:

- `APP_ENV`
- `APP_SECRET`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- `MODAL_ENVIRONMENT`
- `MODAL_APP_NAME`
- `BASETEN_API_KEY`
- `BASETEN_BASE_URL`
- `OPENAI_API_KEY` or other verifier provider key, if enabled

Required `forge-web` environment variables:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `API_INTERNAL_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not expose provider keys, service-role keys, or database URLs through
`NEXT_PUBLIC_*`.

## Migration Sequence

Use this order to avoid breaking the deployed demo while replacing the backend.

1. Add `apps/api` FastAPI service with `/health` and `/v1/capabilities`.
2. Add Python domain/request/response models matching current TypeScript types.
3. Port mock behavior into Python behind service classes.
4. Add smoke tests that run against the Python API locally.
5. Wire Supabase persistence into Python services.
6. Add API-key auth and tenant checks.
7. Update Next.js dashboard to call `NEXT_PUBLIC_API_BASE_URL`.
8. Keep existing Next route handlers as temporary compatibility proxies.
9. Add Modal worker app and provider job records.
10. Add checkpoint artifact storage and export path.
11. Add Baseten invocation/deployment adapter.
12. Add analytics event writes on every API request and provider job event.
13. Update `render.yaml` to define `forge-api` and `forge-web`.
14. Deploy both services to Render.
15. Run local and remote smoke tests through the UI and Python SDK.
16. Remove or deprecate direct business logic from Next route handlers.

## Acceptance Criteria

The feature change is complete when all of these are true:

- A customer can install/import the Forge Python SDK locally.
- The SDK can create a session, run `forward_backward`, run `optim_step`, call
  `sample`, save a checkpoint, score with the verifier, and create/invoke a
  deployment against the hosted API.
- The hosted Python API is deployed on Render and owns all product writes.
- Supabase stores sessions, runs, checkpoints, deployments, provider jobs,
  verifier scores, API events, usage events, and billing ledger rows.
- The dashboard reads real Python API state rather than local file-backed mock
  state.
- Modal job IDs and logs are visible in persisted run/provider-job records.
- Baseten configured deployments can be invoked from the dashboard and SDK.
- API-key auth and tenant checks are enforced on customer routes.
- Remote smoke tests pass against the Render deployment.
- The repo language mix visibly includes Python for backend and SDK code.

## Tests To Add

- Python unit tests for domain models, auth, analytics event writing, and service
  methods.
- FastAPI route tests for every `/v1` endpoint.
- Supabase integration tests for tenant isolation and RLS-sensitive queries.
- Modal provider adapter tests with mocked Modal responses.
- Baseten adapter tests with mocked OpenAI-compatible responses.
- SDK contract tests that exercise the same flow as a customer script.
- Existing Next smoke test updated to run against the Python API.

## Immediate Next Task

Start with a narrow vertical slice:

1. Create `apps/api` with FastAPI, Pydantic models, settings, and `/health`.
2. Implement `/v1/capabilities`, `/v1/sessions`, `/v1/runs`,
   `/v1/training-runs/{run_id}/forward-backward`, and
   `/v1/training-runs/{run_id}/optim-step` using an in-memory repository.
3. Add `packages/forge` with `ServiceClient` and `TrainingClient`.
4. Add Python smoke test that creates a session and performs one mock training
   step.
5. Update the dashboard to use the Python API base URL in development.

That slice proves the new backend boundary before touching Supabase, Modal, or
Baseten.

## July 23, 2026 Implementation Update

The first Python backend slice is now implemented:

- `apps/api`: FastAPI service with `/health`, `/api/state`, `/v1/capabilities`,
  projects, sessions, runs, training primitives, sampling jobs, checkpoints,
  deployments, verifier routes, and `/api/v1/*` direct-call aliases.
- `packages/forge`: installable Python SDK exposing `ServiceClient`,
  `TrainingClient`, `SamplingClient`, and `APIFuture`.
- `workers/modal`: placeholder Modal worker package boundary.
- Next.js route handlers now proxy to the Python API instead of owning product
  writes.
- The dashboard uses `NEXT_PUBLIC_API_BASE_URL` when configured.
- `render.yaml` now defines separate `forge-api` and `forge-web` services.

Verified locally:

- `/opt/anaconda3/bin/python -m pytest tests -q` from `apps/api`
- `npm run build`
- `/opt/anaconda3/bin/python scripts/python_smoke.py` with FastAPI running
- `SMOKE_BASE_URL=http://localhost:8000 npm run smoke` with FastAPI running

Remaining product work:

- Replace the file-backed Python repository with Supabase persistence.
- Add API-key auth, tenant checks, usage events, API events, and billing ledger
  writes.
- Replace Modal/Baseten mocks with real provider job and deployment adapters.
- Store checkpoint artifacts and LoRA metadata in Supabase Storage/Postgres.
