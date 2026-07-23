# Deployment Runbook

This runbook documents the deployment contract for the Forge MVP. It is scoped to
docs and devops configuration; the application source still needs to implement
the routes and scripts referenced here.

## Deployment Shape

Forge deploys as one Render web service:

- Runtime: Node
- Framework: Next.js
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health check: `GET /api/health`
- State: external Supabase project
- Remote compute: Modal service-user token
- Serving adapter: Baseten API key and OpenAI-compatible base URL

This keeps the first MVP deploy small while preserving the intended split from
`plan.md`: Render hosts the control plane, Supabase stores product state and
artifacts, Modal runs remote jobs, and Baseten serves model endpoints.

## Source Requirements

Implementation agents should make the app source satisfy this contract before
attempting a production deploy:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p ${PORT:-3000}"
  }
}
```

If the app enables Next.js standalone output with `output: "standalone"`, use a
start script that runs `.next/standalone/server.js` with `PORT` and
`HOSTNAME=0.0.0.0` instead.

The application must also implement:

- `GET /api/health` for Render health checks.
- Server-side provider clients that read Modal, Baseten, Supabase secret, and
  database credentials only from server-side environment variables.
- Browser Supabase clients that use only public Supabase values.

## Environment Variables

Use [.env.example](../.env.example) as the source of truth for local values. On
Render, all real secrets are configured through `sync: false` entries in
[render.yaml](../render.yaml) so they are entered in the dashboard and not
committed.

Key groups:

- App: `APP_URL`, `APP_SECRET`, `ENCRYPTION_KEY`, `LOG_LEVEL`
- Supabase browser: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Supabase server: `SUPABASE_SECRET_KEY`, optional
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_DATABASE_URL`
- Modal: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_ENVIRONMENT`,
  `MODAL_APP_NAME`
- Baseten: `BASETEN_API_KEY`, `BASETEN_BASE_URL`,
  `BASETEN_DEPLOYMENT_BASE_URL`, `BASETEN_DEFAULT_MODEL`
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
BASETEN_API_KEY=...
```

When a fine-tuned checkpoint is exported to a dedicated Baseten deployment, set:

```bash
BASETEN_DEPLOYMENT_BASE_URL=https://model-<model-id>.api.baseten.co/environments/production/sync/v1
```

## Render Deployment

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Render, create a new Blueprint from the repository.
3. Confirm the Blueprint reads [render.yaml](../render.yaml).
4. Fill every `sync: false` value in the Render dashboard.
5. Deploy the `forge-mvp` web service.
6. Verify the health check:

```bash
curl -fsS https://<render-service>.onrender.com/api/health
```

7. Run a browser smoke test:

```text
Sign in or open dashboard -> create project -> start session -> submit sample job -> view checkpoint/eval status.
```

## Current Documentation Checked

The deployment config was aligned with current docs for:

- Next.js Node server deployment and standalone output.
- Render Blueprint fields for Node web services, env vars, generated secrets,
  service references, and health checks.
- Supabase Next.js environment variables and server-only secret-key handling.
- Modal service-user token environment variables.
- Baseten OpenAI-compatible Model API and deployment endpoint shapes.
