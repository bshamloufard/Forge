revoke all on table public.organizations from anon, authenticated;
revoke all on table public.projects from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
revoke all on table public.runs from anon, authenticated;
revoke all on table public.run_events from anon, authenticated;
revoke all on table public.checkpoints from anon, authenticated;
revoke all on table public.verifier_jobs from anon, authenticated;
revoke all on table public.deployments from anon, authenticated;

grant usage on schema public to authenticated;

grant select on table public.organizations to authenticated;
grant select on table public.projects to authenticated;
grant select on table public.sessions to authenticated;
grant select on table public.runs to authenticated;
grant select on table public.run_events to authenticated;
grant select on table public.checkpoints to authenticated;
grant select on table public.verifier_jobs to authenticated;
grant select on table public.deployments to authenticated;
