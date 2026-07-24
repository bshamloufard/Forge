"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { SafeAccountSummary } from "@/lib/account";
import styles from "./account.module.css";

export type ReadinessTone = "ready" | "setup";

type ProviderFormState = {
  modalTokenId: string;
  modalTokenSecret: string;
  basetenApiKey: string;
  modalAppName: string;
  modalEnvironment: string;
  basetenModelId: string;
};

type AccountResponse = {
  account?: SafeAccountSummary;
  error?: string;
  fieldErrors?: Partial<Record<keyof ProviderFormState, string[]>>;
};

const emptyForm: ProviderFormState = {
  modalTokenId: "",
  modalTokenSecret: "",
  basetenApiKey: "",
  modalAppName: "",
  modalEnvironment: "",
  basetenModelId: ""
};

export function ProviderSettingsForm({
  initialAccount,
  compact = false,
  onSaved
}: {
  initialAccount: SafeAccountSummary;
  compact?: boolean;
  onSaved?: (account: SafeAccountSummary) => void;
}) {
  const router = useRouter();
  const [account, setAccount] = useState(initialAccount);
  const [form, setForm] = useState<ProviderFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    AccountResponse["fieldErrors"]
  >({});
  const [saved, setSaved] = useState(false);

  function updateField(name: keyof ProviderFormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setSaved(false);
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    setFieldErrors({});

    try {
      const response = await fetch("/api/account/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });
      const payload = (await response.json()) as AccountResponse;

      if (!response.ok || !payload.account) {
        setError(payload.error || "Could not save provider configuration.");
        setFieldErrors(payload.fieldErrors || {});
        return;
      }

      setAccount(payload.account);
      setForm(emptyForm);
      setSaved(true);
      onSaved?.(payload.account);
      router.refresh();
    } catch {
      setError("Could not reach Forge. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`${styles.providerForm} ${compact ? styles.compactForm : ""}`}
      onSubmit={submit}
    >
      {!compact ? (
        <header className={styles.formHeader}>
          <div>
            <span>Credentials</span>
            <h2>Replace provider configuration</h2>
            <p>
              Leave a secret blank to keep its current value. Forge never reads
              an existing secret back into your browser.
            </p>
          </div>
          <ShieldCheck size={20} />
        </header>
      ) : null}

      <div className={styles.providerSection}>
        <ProviderHeading
          name="Modal"
          copy="Required for training jobs."
          configured={account.providers.modal}
        />
        <div className={styles.fieldGrid}>
          <SecretField
            label="Token ID"
            name="modalTokenId"
            placeholder={
              account.providers.modal
                ? "Configured — enter to replace"
                : "Enter Modal token ID"
            }
            value={form.modalTokenId}
            error={fieldErrors?.modalTokenId?.[0]}
            onChange={updateField}
          />
          <SecretField
            label="Token secret"
            name="modalTokenSecret"
            placeholder={
              account.providers.modal
                ? "Configured — enter to replace"
                : "Enter Modal token secret"
            }
            value={form.modalTokenSecret}
            error={fieldErrors?.modalTokenSecret?.[0]}
            onChange={updateField}
          />
          <TextField
            label="App name"
            name="modalAppName"
            placeholder="forge-mvp"
            value={form.modalAppName}
            error={fieldErrors?.modalAppName?.[0]}
            onChange={updateField}
          />
          <TextField
            label="Environment"
            name="modalEnvironment"
            placeholder="main"
            value={form.modalEnvironment}
            error={fieldErrors?.modalEnvironment?.[0]}
            onChange={updateField}
          />
        </div>
      </div>

      <div className={styles.providerSection}>
        <ProviderHeading
          name="Baseten"
          copy="Required for serving and deployment."
          configured={account.providers.baseten}
        />
        <div className={styles.fieldGrid}>
          <SecretField
            label="API key"
            name="basetenApiKey"
            placeholder={
              account.providers.baseten
                ? "Configured — enter to replace"
                : "Enter Baseten API key"
            }
            value={form.basetenApiKey}
            error={fieldErrors?.basetenApiKey?.[0]}
            onChange={updateField}
          />
          <TextField
            label="Default model ID"
            name="basetenModelId"
            placeholder="zai-org/GLM-5.2-Fast"
            value={form.basetenModelId}
            error={fieldErrors?.basetenModelId?.[0]}
            onChange={updateField}
          />
        </div>
        <p className={styles.fixedEndpoint}>
          Requests use Forge&apos;s allowlisted Baseten API endpoint.
        </p>
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          <CircleAlert size={15} />
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className={styles.formSuccess} role="status">
          <CheckCircle2 size={15} />
          Provider settings saved. Secret fields have been cleared.
        </p>
      ) : null}

      <footer className={styles.formFooter}>
        <p>
          <KeyRound size={14} />
          Encrypted server-side and never returned by this API.
        </p>
        <button
          className={styles.saveButton}
          type="submit"
          disabled={busy || !account.available}
        >
          {busy ? <LoaderCircle className={styles.spin} size={16} /> : null}
          {busy ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}

export function ProviderOnboardingDialog({
  initialAccount,
  showOnboarding,
  onAccountChange
}: {
  initialAccount: SafeAccountSummary;
  showOnboarding: boolean;
  onAccountChange?: (account: SafeAccountSummary) => void;
}) {
  const [phase, setPhase] = useState<"open" | "closed">(
    showOnboarding ? "open" : "closed"
  );
  const [account, setAccount] = useState(initialAccount);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase === "open") headingRef.current?.focus();
  }, [phase]);

  if (phase === "closed") return null;

  return (
    <div className={styles.modalBackdrop}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-onboarding-title"
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={() => setPhase("closed")}
          aria-label="Skip provider setup"
        >
          <X size={17} />
        </button>
        <div className={styles.modalIntro}>
          <span>Welcome to Forge</span>
          <h2 id="provider-onboarding-title" tabIndex={-1} ref={headingRef}>
            Connect training and serving
          </h2>
          <p>
            Add your provider credentials now, or skip and connect them later
            from Account. Forge supplies the shared Supabase storage.
          </p>
        </div>

        <ProviderSettingsForm
          compact
          initialAccount={account}
          onSaved={(nextAccount) => {
            setAccount(nextAccount);
            onAccountChange?.(nextAccount);
            setPhase("closed");
          }}
        />

        <button
          type="button"
          className={styles.skipButton}
          onClick={() => setPhase("closed")}
        >
          Skip for now
        </button>
      </section>
    </div>
  );
}

function ProviderHeading({
  name,
  copy,
  configured
}: {
  name: string;
  copy: string;
  configured: boolean;
}) {
  return (
    <div className={styles.providerHeading}>
      <div>
        <strong>{name}</strong>
        <span>{copy}</span>
      </div>
      <span data-ready={configured}>
        {configured ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
        {configured ? "Configured" : "Not configured"}
      </span>
    </div>
  );
}

function SecretField({
  label,
  name,
  placeholder,
  value,
  error,
  onChange
}: FieldProps) {
  return (
    <label className={styles.field}>
      {label}
      <input
        type="password"
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="new-password"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {error ? <small className={styles.fieldError}>{error}</small> : null}
    </label>
  );
}

function TextField({
  label,
  name,
  placeholder,
  value,
  error,
  onChange
}: FieldProps) {
  return (
    <label className={styles.field}>
      {label}
      <input
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {error ? <small className={styles.fieldError}>{error}</small> : null}
    </label>
  );
}

type FieldProps = {
  label: string;
  name: keyof ProviderFormState;
  placeholder: string;
  value: string;
  error?: string;
  onChange: (name: keyof ProviderFormState, value: string) => void;
};
