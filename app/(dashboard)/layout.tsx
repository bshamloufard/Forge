import { ForgeShell } from "@/app/_components/forge-product";
import { getAccountSummary } from "@/lib/account";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: onboardingClaim } = await supabase.rpc(
    "claim_provider_onboarding"
  );
  const account = await getAccountSummary(supabase, user);
  const accountVersion =
    account.providers.updatedAt ||
    account.onboardingSeenAt ||
    account.user.id;

  return (
    <ForgeShell
      key={accountVersion}
      initialAccount={account}
      showOnboarding={onboardingClaim === true}
    >
      {children}
    </ForgeShell>
  );
}
