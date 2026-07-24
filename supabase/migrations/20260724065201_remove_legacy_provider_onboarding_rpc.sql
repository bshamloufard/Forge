-- The atomic claim RPC supersedes this earlier implementation. Removing the
-- unused function keeps the exposed authenticated RPC surface minimal.
drop function if exists public.complete_provider_onboarding();
