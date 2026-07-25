# Deployment Runbook

This runbook documents the deployment contract for the Forge MVP after the
Python backend migration.

## Deployment Shape

Forge deploys as two Render web services:

- `forge-api`: Python/FastAPI customer API and SDK-compatible backend.
- `forge-web`: Next.js dashboard and temporary compatibility proxy routes.

`forge-api`:

- Runtime: Python
- Build command: `pip install -e apps/api -e packages/forge`
- Start command: `cd apps/api && uvicorn forge_api.main:app --host 0.0.0.0 --port $PORT`
- Health check: `GET /health`
- State: local Render disk for transitional state, with Supabase schema and storage provisioned

`forge-web`:

- Runtime: Node
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health check: `GET /api/health`, proxied to `forge-api`

Provider targets:

- State: Supabase project once the persistence adapter is enabled
- Remote compute: Modal service-user token
- Serving adapter: Baseten API key and OpenAI-compatible base URL

This preserves the intended split from `plan.md`: Python owns the product API,
Next.js owns the dashboard, Supabase stores product state and artifacts, Modal
runs remote jobs, and Baseten serves model endpoints.

## Source Requirements

Implementation agents should make the app source satisfy this contract before
attempting a production deploy:

```json
{
  "scripts": {
    "dev": "next dev",
    "api:dev": "cd apps/api && uvicorn forge_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --reload",
    "api:test": "cd apps/api && python -m pytest tests -q",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p ${PORT:-3000}"
  }
}
```

If the app enables Next.js standalone output with `output: "standalone"`, use a
start script that runs `.next/standalone/server.js` with `PORT` and
`HOSTNAME=0.0.0.0` instead.

The services must also implement:

- `GET /health` on `forge-api` for Render health checks.
- `GET /api/health` on `forge-web` as a compatibility proxy.
- `NEXT_PUBLIC_API_BASE_URL` for browser calls from the dashboard.
- `API_INTERNAL_HOSTPORT` for server-side Next.js route proxies over Render's
  private network. `API_INTERNAL_BASE_URL` remains a local fallback.
- Server-side provider clients that read Modal, Baseten, Supabase secret, and
  database credentials only from server-side environment variables.
- Browser Supabase clients that use only public Supabase values.

## Environment Variables

Use [.env.example](../.env.example) as the source of truth for local values. On
Render, all real secrets are configured through `sync: false` entries in
[render.yaml](../render.yaml) so they are entered in the dashboard and not
committed.

Key groups:

- App: `APP_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_HOSTPORT`,
  `FORGE_STATE_PATH`, `FORGE_ALLOWED_ORIGINS`
- Supabase browser: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Supabase server: `SUPABASE_SECRET_KEY`, optional
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_DATABASE_URL`
- Modal: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_ENVIRONMENT`,
  `MODAL_APP_NAME`
- Baseten: `BASETEN_API_KEY`, `BASETEN_BASE_URL`,
  `BASETEN_MANAGEMENT_BASE_URL`, `BASETEN_DEPLOYMENT_BASE_URL`,
  `BASETEN_DEFAULT_MODEL`
- Optional verifier/router providers: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `DEFAULT_BASE_MODEL`, `VERIFIER_MODEL`

Security notes:

- Never prefix service-role, secret, Modal, Baseten, OpenAI, or Anthropic keys
  with `NEXT_PUBLIC_`.
- Treat Supabase `SUPABASE_SECRET_KEY` and legacy `SUPABASE_SERVICE_ROLE_KEY` as
  server-only because they can bypass row-level security.
- Use Render generated values or dashboard-entered values for secrets; do not
  commit real values in `render.yaml`.

## Provider Setup

### Supabase

Create a Supabase project and collect:

- Project URL
- Publishable key for browser usage
- Secret key for server-side privileged usage
- Pooled Postgres connection string for `DATABASE_URL`
- Direct Postgres connection string for migrations as `DIRECT_DATABASE_URL`

Before relying on public Data API access for new tables, verify the project's
Data API exposure settings and row-level security policies. Current Supabase
breaking-change notes indicate new public-schema tables may not be exposed
automatically.

### Modal

Create a Modal service user for deployment automation and set:

```bash
MODAL_TOKEN_ID=...
MODAL_TOKEN_SECRET=...
```

These credentials let server-side code and CI deploy or invoke Modal apps without
interactive login.

### Baseten

For the temporary MVP, use Baseten Model APIs:

```bash
BASETEN_BASE_URL=https://inference.baseten.co/v1
BASETEN_MANAGEMENT_BASE_URL=https://api.baseten.co/v1
BASETEN_API_KEY=...
```

When a fine-tuned checkpoint is exported to a dedicated Baseten deployment, set:

```bash
BASETEN_DEPLOYMENT_BASE_URL=https://model-<model-id>.api.baseten.co/environments/production/sync/v1
```

## Deployment cost controls

The Deploy page is the control plane for provider-backed serving resources:

- **Pause** calls Baseten's deployment deactivation API. This stops serving
  compute spend while retaining the model configuration and stored artifacts.
- **Resume** calls Baseten's deployment activation API.
- **Delete endpoint** deletes the Baseten model, which also deletes all of that
  model's Baseten deployments. Forge removes its local deployment record only
  after the provider confirms deletion (or confirms that it was already gone).
- **Delete saved model** first deletes every linked Baseten model, then removes
  the checkpoint directory from the `forge-checkpoints` Modal Volume once no
  other saved model references it. Forge removes local records only after those
  provider operations succeed.

Modal functions are serverless and scale to zero when idle; Modal does not
provide a reversible pause for a deployed App. Persistent Modal Volume data is a
separate storage resource, so it remains until the saved model is deleted.
Dedicated Modal serving endpoints are intentionally disabled until Forge can
create and track a real per-model Modal resource; the previous placeholder URL
was not a provider deployment.

## Render Deployment

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Render, create a new Blueprint from the repository.
3. Confirm the Blueprint reads [render.yaml](../render.yaml).
4. Fill every `sync: false` value in the Render dashboard.
5. Deploy `forge-api` and `forge-web`.
6. Confirm Render populated `API_INTERNAL_HOSTPORT` on `forge-web` from the
   `forge-api` private-network address.
7. Verify health checks:

```bash
curl -fsS https://<forge-api>.onrender.com/health
curl -fsS https://<forge-web>.onrender.com/api/health
```

8. Run smoke tests:

```bash
SMOKE_BASE_URL=https://<forge-api>.onrender.com npm run smoke
```

9. Run a browser smoke test:

```text
Sign in or open dashboard -> create project -> start session -> submit sample job -> view checkpoint/eval status.
```

## Render Pro Configuration

The Blueprint opts into Pro workspace capabilities while bounding compute cost:

- Both production services use paid Starter instances, so they do not spin down
  like free instances.
- The Blueprint includes the bounded autoscaling settings next to each service.
  Render requires the first sync to upgrade an existing free service to Starter;
  after that sync, uncomment the `scaling` blocks to allow one to three instances
  at 70% CPU or 75% memory utilization.
- Pull request preview environments are manual. Add `[render preview]` to a pull
  request title to create one; inactive previews expire after three days.
- `Forge / Production` is protected from destructive non-admin actions and
  isolated from private-network traffic outside the environment.
- Deploys and scale-downs allow up to 120 seconds for graceful shutdown.

Preview resources are billed while they exist. Render does not copy `sync: false`
variables into previews, so add required preview-only credentials through a
Render environment group before requesting a full authenticated preview.

## Current Documentation Checked

The deployment config was aligned with current docs for:

- FastAPI route, CORS, and TestClient patterns.
- Next.js Node server deployment and route handler proxying.
- Render Blueprint fields for Python and Node web services, env vars, generated
  secrets, disks, and health checks.
- Supabase Next.js environment variables and server-only secret-key handling.
- Modal service-user token environment variables.
- Baseten OpenAI-compatible Model API and deployment endpoint shapes.
