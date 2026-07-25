import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  isGoogleProviderEnabled,
  sanitizeNextPath
} from "@/lib/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import { AnimatedGradientBackground } from "./_components/animated-gradient-background";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "Sign in - Forge"
  },
  description: "Sign in to your Forge post-training workspace."
};

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; auth_error?: string }>;
}) {
  const query = await searchParams;
  const authConfigured = hasSupabasePublicConfig();
  const googleEnabled = authConfigured
    ? await isGoogleProviderEnabled()
    : false;
  const user = authConfigured ? await getCurrentUser() : null;

  if (user) redirect(sanitizeNextPath(query.next));

  const next = sanitizeNextPath(query.next);

  return (
    <main className={styles.page}>
      <AnimatedGradientBackground
        breathing
        gradientColors={[
          "#080c11",
          "#121d2a",
          "#1c3042",
          "#2b465d",
          "#49465d",
          "#34504f",
          "#11171d"
        ]}
        gradientStops={[27, 43, 57, 70, 82, 93, 100]}
        startingGap={118}
        breathingRange={4}
        animationSpeed={0.00045}
        topOffset={7}
      />

      <div className={styles.vignette} aria-hidden="true" />

      <section className={styles.signIn} aria-labelledby="forge-title">
        <div className={styles.brand}>
          <h1 id="forge-title">Forge</h1>
        </div>

        <form action="/auth/google" method="post" className={styles.authForm}>
          <input type="hidden" name="next" value={next} />
          <button
            className={styles.googleButton}
            type="submit"
            disabled={!googleEnabled}
          >
            <GoogleMark />
            <span>Continue with Google</span>
          </button>
        </form>

        {!authConfigured ? (
          <p className={styles.notice} role="status">
            Authentication setup is incomplete. Configure Supabase to enable
            sign-in.
          </p>
        ) : !googleEnabled ? (
          <p className={styles.notice} role="status">
            Google sign-in is being connected. Please check back shortly.
          </p>
        ) : query.auth_error ? (
          <p className={styles.notice} role="alert">
            Sign-in did not complete. Please try again.
          </p>
        ) : null}
      </section>

      <p className={styles.footer}>The post-training workspace</p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.25-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.92A6 6 0 0 1 6.07 12c0-.67.11-1.32.32-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.63.39 3.17 1.04 4.54l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}
