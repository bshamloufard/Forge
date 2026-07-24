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
  modalEnvironment: string;
  basetenModelId: string;
};

type AccountResponse = {
  account?: SafeAccountSummary;
  error?: string;
  fieldErrors?: Partial<Record<keyof ProviderFormState, string[]>>;
  verification?: {
    modal?: {
      status: "ready" | "invalid" | "unavailable" | "conflict";
      message: string;
      provisioned: boolean;
    } | null;
    baseten?: {
      status: "ready" | "invalid" | "unavailable" | "conflict";
      message: string;
      provisioned: boolean;
    } | null;
  } | null;
};

const emptyForm: ProviderFormState = {
  modalTokenId: "",
  modalTokenSecret: "",
  basetenApiKey: "",
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
  const [savedMessage, setSavedMessage] = useState("");
  const [retryingModal, setRetryingModal] = useState(false);
  const hasChanges = Object.values(form).some((value) => value.trim());

  function updateField(name: keyof ProviderFormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setSaved(false);
    setSavedMessage("");
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges) return;
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
      const modalSetup = payload.verification?.modal;
      if (modalSetup && modalSetup.status !== "ready") {
        setSaved(false);
        setError(`Credentials saved. ${modalSetup.message}`);
      } else {
        setSaved(true);
        setSavedMessage(
          modalSetup?.provisioned
            ? "Settings saved. Forge installed and verified your Modal worker."
            : payload.verification?.baseten
              ? "Provider settings saved and connection verified."
              : "Provider settings saved."
        );
        onSaved?.(payload.account);
      }
      router.refresh();
    } catch {
      setError("Could not reach Forge. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retryModal() {
    setRetryingModal(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/account/providers/retry-modal", {
        method: "POST"
      });
      const payload = (await response.json()) as AccountResponse;
      if (!response.ok || !payload.account) {
        setError(payload.error || "Modal setup did not complete.");
        return;
      }
      setAccount(payload.account);
      setSaved(true);
      setSavedMessage("Modal worker installed and verified.");
      onSaved?.(payload.account);
      router.refresh();
    } catch {
      setError("Could not reach Forge. Check your connection and try again.");
    } finally {
      setRetryingModal(false);
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
              an existing secret back into your browser. Replacements are
              verified before the saved value changes; Modal token ID and
              secret are replaced together.
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
          credentialsStored={account.providers.modalCredentialsStored}
          pending={["pending", "provisioning"].includes(
            account.providers.modalWorkerState
          )}
        />
        <div className={styles.fieldGrid}>
          <SecretField
            label="Token ID"
            name="modalTokenId"
            placeholder={
              account.providers.modalCredentialsStored
                ? "Saved — enter to replace"
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
              account.providers.modalCredentialsStored
                ? "Saved — enter to replace"
                : "Enter Modal token secret"
            }
            value={form.modalTokenSecret}
            error={fieldErrors?.modalTokenSecret?.[0]}
            onChange={updateField}
          />
          <TextField
            label="Environment"
            name="modalEnvironment"
            placeholder="Leave blank to keep current (default: main)"
            value={form.modalEnvironment}
            error={fieldErrors?.modalEnvironment?.[0]}
            onChange={updateField}
          />
        </div>
        <p className={styles.fixedEndpoint}>
          Forge owns and updates the reserved <code>forge-mvp</code> app in your
          Modal workspace. The first install can take several minutes.
        </p>
        {account.providers.modalCredentialsStored &&
        !account.providers.modal ? (
          <button
            className={styles.retryButton}
            type="button"
            disabled={busy || retryingModal}
            onClick={retryModal}
          >
            {retryingModal ? (
              <LoaderCircle className={styles.spin} size={15} />
            ) : null}
            {retryingModal ? "Retrying Modal setup…" : "Retry Modal setup"}
          </button>
        ) : null}
      </div>

      <div className={styles.providerSection}>
        <ProviderHeading
          name="Baseten"
          copy="Required for serving and deployment."
          configured={account.providers.baseten}
          credentialsStored={account.providers.basetenCredentialsStored}
        />
        <div className={styles.fieldGrid}>
          <SecretField
            label="API key"
            name="basetenApiKey"
            placeholder={
              account.providers.basetenCredentialsStored
                ? "Saved — enter to replace"
                : "Enter Baseten API key"
            }
            value={form.basetenApiKey}
            error={fieldErrors?.basetenApiKey?.[0]}
            onChange={updateField}
          />
          <TextField
            label="Default model ID"
            name="basetenModelId"
            placeholder="Leave blank to keep current model"
            value={form.basetenModelId}
            error={fieldErrors?.basetenModelId?.[0]}
            onChange={updateField}
          />
        </div>
        <p className={styles.fixedEndpoint}>
          Forge checks management access without running inference. Use a
          personal key or a full-access team key.
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
          {savedMessage}
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
          disabled={busy || !account.available || !hasChanges}
        >
          {busy ? <LoaderCircle className={styles.spin} size={16} /> : null}
          {busy ? "Verifying & saving…" : "Save & verify"}
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
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (phase !== "open") return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPhase("closed");
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !modalRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [phase]);

  if (phase === "closed") return null;

  return (
    <div className={styles.modalBackdrop}>
      <section
        ref={modalRef}
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
  configured,
  credentialsStored,
  pending = false
}: {
  name: string;
  copy: string;
  configured: boolean;
  credentialsStored: boolean;
  pending?: boolean;
}) {
  const label = configured
    ? "Ready"
    : pending
      ? "Setting up"
      : credentialsStored
        ? "Needs attention"
        : "Not configured";
  return (
    <div className={styles.providerHeading}>
      <div>
        <strong>{name}</strong>
        <span>{copy}</span>
      </div>
      <span data-ready={configured}>
        {configured ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
        {label}
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
