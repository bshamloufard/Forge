import {
  CheckCircle2,
  CircleAlert,
  Database,
  LogOut,
  Server,
  Sparkles
} from "lucide-react";
import { getAccountSummary } from "@/lib/account";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ProviderSettingsForm,
  type ReadinessTone
} from "./provider-settings-form";
import styles from "./account.module.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const account = await getAccountSummary(supabase, user);

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div>
          <span>Account</span>
          <h1>Provider settings</h1>
          <p>
            Connect the accounts Forge uses for training and serving. Existing
            secrets are never loaded into this page.
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button className={styles.signOut} type="submit">
            <LogOut size={15} />
            Sign out
          </button>
        </form>
      </header>

      {!account.available ? (
        <div className={styles.warning} role="alert">
          <CircleAlert size={17} />
          <div>
            <strong>Account storage is not available</strong>
            <p>
              Apply the account migration before saving provider credentials.
            </p>
          </div>
        </div>
      ) : null}

      <section className={styles.identityCard}>
        <Avatar
          name={account.user.displayName}
          avatarUrl={account.user.avatarUrl}
        />
        <div>
          <span>Signed in as</span>
          <strong>{account.user.displayName}</strong>
          <p>{account.user.email}</p>
        </div>
      </section>

      <section className={styles.statusGrid} aria-label="Provider configuration">
        <ReadinessCard
          icon={<Sparkles size={17} />}
          label="Training"
          provider="Modal"
          ready={account.providers.modal}
          status={
            account.providers.modal
              ? "Ready"
              : account.providers.modalCredentialsStored
                ? ["pending", "provisioning"].includes(
                    account.providers.modalWorkerState
                  )
                  ? "Setting up"
                  : "Needs attention"
                : "Not configured"
          }
        />
        <ReadinessCard
          icon={<Server size={17} />}
          label="Serving"
          provider="Baseten"
          ready={account.providers.modal && account.providers.baseten}
          status={
            account.providers.modal && account.providers.baseten
              ? "Ready"
              : !account.providers.baseten
                ? account.providers.basetenCredentialsStored
                  ? "Baseten needs attention"
                  : "Not configured"
                : "Waiting on Modal"
          }
        />
        <ReadinessCard
          icon={<Database size={17} />}
          label="Storage"
          provider="Supabase"
          ready={account.providers.storage}
          status={account.providers.storage ? "Ready" : "Not configured"}
        />
      </section>

      <ProviderSettingsForm initialAccount={account} />
    </div>
  );
}

function Avatar({
  name,
  avatarUrl
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    // Google avatar URLs are display-only metadata, never authorization data.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={styles.avatar} src={avatarUrl} alt="" referrerPolicy="no-referrer" />
    );
  }

  return (
    <span className={styles.avatarFallback} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function ReadinessCard({
  icon,
  label,
  provider,
  ready,
  status
}: {
  icon: React.ReactNode;
  label: string;
  provider: string;
  ready: boolean;
  status: string;
}) {
  const tone: ReadinessTone = ready ? "ready" : "setup";
  return (
    <article className={styles.statusCard} data-tone={tone}>
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{provider}</strong>
      <p>
        {ready ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
        {status}
      </p>
    </article>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
