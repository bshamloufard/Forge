import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/app/home.module.css";

export const metadata: Metadata = {
  title: "Sign-in error"
};

const messages: Record<string, string> = {
  config:
    "Google sign-in is not configured yet. Add the Supabase public URL and publishable key, then try again.",
  provider_disabled:
    "Google sign-in is not enabled yet. Finish the Google provider setup in Supabase, then try again.",
  oauth_start:
    "Forge could not start Google sign-in. Check the Google provider and allowed redirect URLs in Supabase.",
  missing_code:
    "Google did not return an authorization code. Start the sign-in flow again.",
  code_exchange:
    "Forge could not finish signing you in. The link may have expired; please try again."
};

export default async function AuthErrorPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    messages[reason ?? ""] ||
    "Forge could not complete sign-in. Please return home and try again.";

  return (
    <main className={styles.page}>
      <section className={styles.errorCard}>
        <Link href="/" className={styles.wordmark}>
          <span>F</span>
          Forge
        </Link>
        <p className={styles.eyebrow}>Authentication</p>
        <h1>Sign-in paused</h1>
        <p>{message}</p>
        <Link href="/" className={styles.primaryLink}>
          Return to Forge
        </Link>
      </section>
    </main>
  );
}
