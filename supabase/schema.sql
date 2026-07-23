create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  creator_user_id uuid,
  name text not null,
  base_model text not null,
  recipe text not null,
  provider text not null default 'modal',
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  status text not null default 'queued',
  step integer not null default 0,
  target_steps integer not null default 100,
  loss numeric not null default 0,
  reward numeric not null default 0,
  verifier_score numeric not null default 0,
  tokens bigint not null default 0,
  cost_usd numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  name text not null,
  kind text not null default 'sampler_weights',
  adapter_type text not null default 'lora',
  step integer not null,
  artifact_uri text not null,
  score numeric not null default 0,
  visibility text not null default 'private',
  created_at timestamptz not null default now()
);

create table if not exists public.verifier_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  mode text not null,
  rubric text,
  score numeric,
  confidence numeric,
  criterion_scores jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  target text not null,
  status text not null default 'deploying',
  endpoint_url text,
  provider_mode text not null default 'mock',
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.sessions enable row level security;
alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.checkpoints enable row level security;
alter table public.verifier_jobs enable row level security;
alter table public.deployments enable row level security;

-- MVP bootstrap policy. Replace with organization membership policies before
-- exposing user data through Supabase Data API.
create policy "authenticated read organizations" on public.organizations
for select to authenticated using (true);

create policy "authenticated read projects" on public.projects
for select to authenticated using (true);

create policy "authenticated read sessions" on public.sessions
for select to authenticated using (true);

create policy "authenticated read runs" on public.runs
for select to authenticated using (true);

create policy "authenticated read run events" on public.run_events
for select to authenticated using (true);

create policy "authenticated read checkpoints" on public.checkpoints
for select to authenticated using (true);

create policy "authenticated read verifier jobs" on public.verifier_jobs
for select to authenticated using (true);

create policy "authenticated read deployments" on public.deployments
for select to authenticated using (true);
