import type { Metadata } from "next";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cloud,
  LockKeyhole,
  Sparkles,
  Workflow
} from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser, sanitizeNextPath } from "@/lib/auth";
import { hasSupabasePublicConfig } from "@/lib/supabase/config";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forge — Train, evaluate, and deploy models",
  description:
    "A focused control plane for post-training workflows, evaluation, checkpoints, and deployment."
};

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; auth_error?: string }>;
}) {
  const query = await searchParams;
  const authConfigured = hasSupabasePublicConfig();
  const user = authConfigured ? await getCurrentUser() : null;
  if (user) redirect(sanitizeNextPath(query.next));

  const next = sanitizeNextPath(query.next);

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Landing navigation">
        <a href="#top" className={styles.wordmark}>
          <span>F</span>
          Forge
        </a>
        <form action="/auth/google" method="post">
          <input type="hidden" name="next" value={next} />
          <button
            className={styles.navAction}
            type="submit"
            disabled={!authConfigured}
          >
            Sign in
            <ArrowRight size={15} />
          </button>
        </form>
      </nav>

      <div id="top" className={styles.hero}>
        <section className={styles.heroCopy}>
          <p className={styles.eyebrow}>The post-training control plane</p>
          <h1>From a base model to a running endpoint, in one workspace.</h1>
          <p className={styles.lede}>
            Configure training, inspect progress, evaluate outputs, save
            checkpoints, and deploy verified models without stitching together
            five dashboards.
          </p>

          <form action="/auth/google" method="post" className={styles.authForm}>
            <input type="hidden" name="next" value={next} />
            <button
              className={styles.googleButton}
              type="submit"
              disabled={!authConfigured}
            >
              <GoogleMark />
              Continue with Google
              <ArrowRight size={17} />
            </button>
            <span>
              One account for training, evaluation, storage, and serving.
            </span>
          </form>

          {!authConfigured ? (
            <p className={styles.notice} role="status">
              Authentication setup is incomplete. Configure Supabase to enable
              sign-in.
            </p>
          ) : query.auth_error ? (
            <p className={styles.notice} role="alert">
              Sign-in did not complete. Please try again.
            </p>
          ) : null}
        </section>

        <section className={styles.preview} aria-label="Forge workflow preview">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.logoTile}>F</span>
              <div>
                <strong>Forge Research</strong>
                <small>Training workspace</small>
              </div>
            </div>
            <span className={styles.liveBadge}>
              <span />
              Connected
            </span>
          </div>

          <ol className={styles.workflow}>
            {["Configure", "Train", "Evaluate", "Save", "Deploy"].map(
              (label, index) => (
                <li
                  key={label}
                  className={index < 3 ? styles.complete : undefined}
                >
                  <span>
                    {index < 3 ? <CheckCircle2 size={13} /> : index + 1}
                  </span>
                  {label}
                </li>
              )
            )}
          </ol>

          <div className={styles.runCard}>
            <div className={styles.runHeading}>
              <div>
                <small>SELECTED RUN</small>
                <strong>Research run</strong>
              </div>
              <span>Running</span>
            </div>
            <div className={styles.progress}>
              <span />
            </div>
            <div className={styles.metrics}>
              <Metric label="STEP" value="34 / 100" />
              <Metric label="LOSS" value="0.482" />
              <Metric label="REWARD" value="0.71" />
              <Metric label="VERIFIER" value="0.84" />
            </div>
          </div>

          <div className={styles.providerStrip}>
            <Provider icon={<Workflow size={15} />} label="Modal" />
            <Provider icon={<Cloud size={15} />} label="Baseten" />
            <Provider icon={<Boxes size={15} />} label="Supabase" />
          </div>
        </section>
      </div>

      <section className={styles.valueStrip} aria-label="Forge benefits">
        <article>
          <Sparkles size={18} />
          <div>
            <strong>Focused workflow</strong>
            <p>Train, test, evaluate, and release without losing context.</p>
          </div>
        </article>
        <article>
          <LockKeyhole size={18} />
          <div>
            <strong>Your provider accounts</strong>
            <p>Credentials stay server-side and are replace-only in Forge.</p>
          </div>
        </article>
        <article>
          <Workflow size={18} />
          <div>
            <strong>Traceable releases</strong>
            <p>Keep runs, checkpoints, scores, and endpoints connected.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Provider({
  icon,
  label
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div>
      {icon}
      <span>{label}</span>
      <i />
    </div>
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
