grant usage on schema public to authenticated;

grant select on table public.organizations to authenticated;
grant select on table public.projects to authenticated;
grant select on table public.sessions to authenticated;
grant select on table public.runs to authenticated;
grant select on table public.run_events to authenticated;
grant select on table public.checkpoints to authenticated;
grant select on table public.verifier_jobs to authenticated;
grant select on table public.deployments to authenticated;
