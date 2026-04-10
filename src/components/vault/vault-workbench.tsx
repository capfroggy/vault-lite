"use client";

import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  DocumentDuplicateIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { createBackupBundle, createBackupFileName, parseBackupBundle } from "@/lib/backup";
import {
  createEncryptedVault,
  PBKDF2_ITERATIONS,
  sealVault,
  unlockVault,
} from "@/lib/crypto/vault-crypto";
import { auditVault } from "@/lib/password/audit";
import { generatePassword, type PasswordRecipe } from "@/lib/password/generator";
import { assessPasswordStrength } from "@/lib/password/strength";
import {
  getEncryptedVault,
  getVaultSettings,
  saveEncryptedVault,
  saveVaultSettings,
} from "@/lib/storage/vault-db";
import {
  createEmptyVault,
  DEFAULT_SETTINGS,
  entrySchema,
  type EncryptedVaultRecord,
  type Vault,
  type VaultEntry,
  type VaultSettings,
} from "@/lib/types";
import {
  FavoriteToggle,
  FileDropRow,
  MetaItem,
  MetricCard,
  RecipeToggle,
  ScoreCard,
  SecureInput,
  DarkChecklistItem,
  TextAreaField,
  TextField,
} from "@/components/vault/primitives";

type Mode = "loading" | "setup" | "locked" | "unlocked";
type SetupMode = "create" | "restore";
type LockReason = "manual" | "inactivity";
type NoticeTone = "error" | "info" | "success";
type Notice = { detail: string; tone: NoticeTone };
type LockState = { lockedAt: string; reason: LockReason };
type EntryDraft = {
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  tagsText: string;
  favorite: boolean;
};

const DEFAULT_RECIPE: PasswordRecipe = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: true,
};

const EMPTY_DRAFT: EntryDraft = {
  title: "",
  username: "",
  password: "",
  website: "",
  notes: "",
  tagsText: "",
  favorite: false,
};

const noticeStyles: Record<NoticeTone, string> = {
  error: "border-[rgba(164,67,44,0.18)] bg-[rgba(164,67,44,0.08)] text-[#8f3824]",
  info: "border-[rgba(15,125,123,0.18)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]",
  success: "border-[rgba(23,107,78,0.18)] bg-[rgba(23,107,78,0.08)] text-[#175941]",
};

function createDraft(password = ""): EntryDraft {
  return { ...EMPTY_DRAFT, password };
}

function entryToDraft(entry: VaultEntry): EntryDraft {
  return {
    title: entry.title,
    username: entry.username,
    password: entry.password,
    website: entry.website,
    notes: entry.notes,
    tagsText: entry.tags.join(", "),
    favorite: entry.favorite,
  };
}

function buildEntryFromDraft(draft: EntryDraft, existing?: VaultEntry) {
  const now = new Date().toISOString();
  return entrySchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    title: draft.title.trim(),
    username: draft.username.trim(),
    password: draft.password,
    website: draft.website.trim()
      ? /^https?:\/\//i.test(draft.website.trim())
        ? draft.website.trim()
        : `https://${draft.website.trim()}`
      : "",
    notes: draft.notes.trim(),
    tags: draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
    favorite: draft.favorite,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Invalid data.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error.";
}

function formatRelative(value: string) {
  const hours = Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatElapsedSince(value: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));

  if (seconds < 60) {
    return {
      compact: `${seconds}s`,
      verbose: `${seconds} second${seconds === 1 ? "" : "s"}`,
    };
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return {
      compact: remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`,
      verbose:
        remainingSeconds > 0
          ? `${minutes} minute${minutes === 1 ? "" : "s"} and ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`
          : `${minutes} minute${minutes === 1 ? "" : "s"}`,
    };
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return {
      compact: remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`,
      verbose:
        remainingMinutes > 0
          ? `${hours} hour${hours === 1 ? "" : "s"} and ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`
          : `${hours} hour${hours === 1 ? "" : "s"}`,
    };
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return {
    compact: remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`,
    verbose:
      remainingHours > 0
        ? `${days} day${days === 1 ? "" : "s"} and ${remainingHours} hour${remainingHours === 1 ? "" : "s"}`
        : `${days} day${days === 1 ? "" : "s"}`,
  };
}

function buildLockHumor(lockState: LockState | null, elapsed: string) {
  if (!lockState) {
    return "VaultLite is ready to keep your secrets local, encrypted, and boringly hard to snoop on.";
  }

  if (lockState.reason === "inactivity") {
    return `For the last ${elapsed}, we kept wandering hackers, sticky-fingered goblins, and one deeply nosy keyboard tourist away from your passwords.`;
  }

  return `For the last ${elapsed}, the vault has been quietly judging anyone who thought your passwords were public property.`;
}

export function VaultWorkbench() {
  const [mode, setMode] = useState<Mode>("loading");
  const [setupMode, setSetupMode] = useState<SetupMode>("create");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lockState, setLockState] = useState<LockState | null>(null);
  const [lockClock, setLockClock] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<EncryptedVaultRecord | null>(null);
  const [settings, setSettings] = useState<VaultSettings>(DEFAULT_SETTINGS);
  const [vault, setVault] = useState<Vault | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(createDraft);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showMaster, setShowMaster] = useState(false);
  const [showDraftPassword, setShowDraftPassword] = useState(false);
  const [recipe, setRecipe] = useState<PasswordRecipe>(DEFAULT_RECIPE);
  const [generatedPassword, setGeneratedPassword] = useState(() =>
    generatePassword(DEFAULT_RECIPE),
  );
  const keyRef = useRef<CryptoKey | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());

  const entries = vault?.entries ?? [];
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const filteredEntries = entries.filter((entry) =>
    !query
      ? true
      : [entry.title, entry.username, entry.website, entry.notes, entry.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(query),
  );
  const audit = auditVault(entries);
  const masterStrength = assessPasswordStrength(setupPassword);
  const draftStrength = assessPasswordStrength(draft.password);
  const lockElapsed = lockState ? formatElapsedSince(lockState.lockedAt, lockClock) : null;
  const lockHumor = buildLockHumor(lockState, lockElapsed?.verbose ?? "a while");

  const lockVault = useCallback(
    ({
      lockedAt = new Date().toISOString(),
      message,
      reason = "manual",
    }: {
      lockedAt?: string;
      message: string;
      reason?: LockReason;
    }) => {
      keyRef.current = null;
      setVault(null);
      setSelectedId(null);
      setDraft(createDraft());
      setUnlockPassword("");
      setRestorePassword("");
      setRestoreFile(null);
      setShowDraftPassword(false);
      setBusy(false);
      setSaving(false);
      setMode(record ? "locked" : "setup");
      setLockState(record ? { lockedAt, reason } : null);
      setLockClock(Date.now());
      setNotice({ tone: "info", detail: message });
    },
    [record],
  );

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [storedRecord, storedSettings] = await Promise.all([
        getEncryptedVault(),
        getVaultSettings(),
      ]);
      if (cancelled) return;
      setRecord(storedRecord);
      setSettings(storedSettings);
      setLockState(null);
      setMode(storedRecord ? "locked" : "setup");
    }
    hydrate().catch((error) => {
      if (!cancelled) {
        setNotice({ tone: "error", detail: getErrorMessage(error) });
        setMode("setup");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setGeneratedPassword(generatePassword(recipe));
  }, [recipe]);

  useEffect(() => {
    if (mode !== "locked" || !lockState) return;
    setLockClock(Date.now());
    const interval = window.setInterval(() => setLockClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [lockState, mode]);

  useEffect(() => {
    if (mode !== "unlocked") return;

    const timeoutMs = settings.autoLockMinutes * 60_000;
    const triggerAutoLock = () => {
      const expiresAt = lastActivityRef.current + timeoutMs;
      lockVault({
        lockedAt: new Date(expiresAt).toISOString(),
        message: "Session closed due to inactivity.",
        reason: "inactivity",
      });
    };
    const scheduleLock = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const expiresAt = lastActivityRef.current + timeoutMs;
      const delay = Math.max(expiresAt - Date.now(), 0);
      timerRef.current = window.setTimeout(triggerAutoLock, delay);
    };
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      scheduleLock();
    };
    const onVisibilityReturn = () => {
      if (document.visibilityState === "hidden") return;
      const expiresAt = lastActivityRef.current + timeoutMs;
      if (Date.now() >= expiresAt) {
        triggerAutoLock();
        return;
      }
      scheduleLock();
    };

    lastActivityRef.current = Date.now();
    scheduleLock();
    window.addEventListener("keydown", onActivity);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("focus", onVisibilityReturn);
    document.addEventListener("visibilitychange", onVisibilityReturn);
    return () => {
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("focus", onVisibilityReturn);
      document.removeEventListener("visibilitychange", onVisibilityReturn);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [lockVault, mode, settings.autoLockMinutes]);

  async function persistVault(nextVault: Vault) {
    if (!keyRef.current || !record) {
      throw new Error("Session expired. Unlock the vault again.");
    }
    const nextRecord = await sealVault(nextVault, keyRef.current, {
      createdAt: record.createdAt,
      kdf: record.kdf,
    });
    await saveEncryptedVault(nextRecord);
    setRecord(nextRecord);
    return { ...nextVault, updatedAt: nextRecord.updatedAt };
  }

  async function createVault(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupPassword !== setupConfirm) {
      setNotice({ tone: "error", detail: "Password confirmation does not match." });
      return;
    }
    if (setupPassword.length < 12 || masterStrength.score < 2) {
      setNotice({ tone: "error", detail: "Use a stronger master password." });
      return;
    }
    setBusy(true);
    try {
      const created = await createEncryptedVault(setupPassword, createEmptyVault());
      await saveEncryptedVault(created.record);
      keyRef.current = created.key;
      setRecord(created.record);
      setLockState(null);
      setVault(created.vault);
      setDraft(createDraft(generatedPassword));
      setMode("unlocked");
      setNotice({ tone: "success", detail: "Vault created locally." });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record) return;
    setBusy(true);
    try {
      const opened = await unlockVault(unlockPassword, record);
      keyRef.current = opened.key;
      setLockState(null);
      setVault(opened.vault);
      setMode("unlocked");
      setUnlockPassword("");
      if (opened.vault.entries[0]) {
        setSelectedId(opened.vault.entries[0].id);
        setDraft(entryToDraft(opened.vault.entries[0]));
      } else {
        setSelectedId(null);
        setDraft(createDraft(generatedPassword));
      }
      setNotice({ tone: "success", detail: "Vault unlocked." });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function restore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restoreFile) {
      setNotice({ tone: "error", detail: "Choose a backup file first." });
      return;
    }
    setBusy(true);
    try {
      const bundle = parseBackupBundle(await restoreFile.text());
      const opened = await unlockVault(restorePassword, bundle.vault);
      await saveEncryptedVault(bundle.vault);
      keyRef.current = opened.key;
      setRecord(bundle.vault);
      setLockState(null);
      setVault(opened.vault);
      setMode("unlocked");
      if (opened.vault.entries[0]) {
        setSelectedId(opened.vault.entries[0].id);
        setDraft(entryToDraft(opened.vault.entries[0]));
      } else {
        setSelectedId(null);
        setDraft(createDraft(generatedPassword));
      }
      setNotice({ tone: "success", detail: "Backup restored successfully." });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vault) return;
    setSaving(true);
    try {
      const nextEntry = buildEntryFromDraft(draft, selectedEntry ?? undefined);
      const nextEntries = selectedEntry
        ? vault.entries.map((entry) => (entry.id === selectedEntry.id ? nextEntry : entry))
        : [nextEntry, ...vault.entries];
      const persisted = await persistVault({ ...vault, entries: nextEntries });
      setVault(persisted);
      setSelectedId(nextEntry.id);
      setDraft(entryToDraft(nextEntry));
      setNotice({
        tone: "success",
        detail: selectedEntry ? "Entry updated." : "Entry saved.",
      });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!vault || !selectedEntry) return;
    setSaving(true);
    try {
      const persisted = await persistVault({
        ...vault,
        entries: vault.entries.filter((entry) => entry.id !== selectedEntry.id),
      });
      setVault(persisted);
      setSelectedId(null);
      setDraft(createDraft(generatedPassword));
      setNotice({ tone: "success", detail: "Entry deleted." });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function exportVault() {
    if (!record) return;
    const bundle = createBackupBundle(record);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createBackupFileName();
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "success", detail: "Encrypted backup exported." });
  }

  const setupPanel =
    mode === "setup" ? (
      setupMode === "create" ? (
        <form className="grid gap-4" onSubmit={createVault}>
          <SecureInput
            label="Master password"
            value={setupPassword}
            onChange={setSetupPassword}
            placeholder="Use a unique passphrase"
            visible={showMaster}
            onToggleVisibility={() => setShowMaster((current) => !current)}
          />
          <ScoreCard
            label="Password strength"
            score={masterStrength.score}
            toneLabel={masterStrength.label}
            feedback={masterStrength.feedback}
          />
          <SecureInput
            label="Confirm master password"
            value={setupConfirm}
            onChange={setSetupConfirm}
            placeholder="Repeat the passphrase"
            visible={showMaster}
            onToggleVisibility={() => setShowMaster((current) => !current)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-[#17120d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create encrypted vault"}
          </button>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={restore}>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-[#47392c]">Backup file</span>
            <FileDropRow fileName={restoreFile?.name ?? null} onChange={setRestoreFile} />
          </div>
          <SecureInput
            label="Master password"
            value={restorePassword}
            onChange={setRestorePassword}
            placeholder="Password used for the backup"
            visible={showMaster}
            onToggleVisibility={() => setShowMaster((current) => !current)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-[#17120d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
          >
            {busy ? "Restoring..." : "Restore backup"}
          </button>
        </form>
      )
    ) : (
      <form className="grid gap-4" onSubmit={unlock}>
        <SecureInput
          label="Master password"
          value={unlockPassword}
          onChange={setUnlockPassword}
          placeholder="Enter your passphrase"
          visible={showMaster}
          onToggleVisibility={() => setShowMaster((current) => !current)}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-[#17120d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
        >
          {busy ? "Unlocking..." : "Unlock vault"}
        </button>
      </form>
    );

  return (
    <main className="vault-shell min-h-screen text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6">
        <header className="panel-glass rounded-[32px] px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(19,17,13,0.1)] bg-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#69513a]">
                <ShieldCheckIcon className="size-4" />
                Local-first security demo
              </div>
              <h1 className="font-display text-4xl font-semibold tracking-tight text-[#17120d] sm:text-5xl">
                VaultLite keeps secrets local and the tradeoffs explicit.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[#5f5044] sm:text-lg">
                A portfolio-ready password manager demo with browser-side encryption,
                local persistence, encrypted backups, and auto-lock.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:w-[560px]">
              <MetricCard
                label="KDF"
                value={`PBKDF2 ${PBKDF2_ITERATIONS.toLocaleString()}`}
                helper="Per-vault salt"
              />
              <MetricCard label="Storage" value="IndexedDB" helper="Encrypted blob only" />
              <MetricCard
                label="Auto-lock"
                value={`${settings.autoLockMinutes}m`}
                helper="Inactivity timeout"
              />
            </div>
          </div>
        </header>

        {notice ? (
          <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${noticeStyles[notice.tone]}`}>
            {notice.detail}
          </div>
        ) : null}

        {mode === "loading" ? (
          <div className="panel-glass flex min-h-[420px] items-center justify-center rounded-[32px]">
            <div className="flex items-center gap-3 text-lg font-semibold text-[#5f5044]">
              <ArrowPathIcon className="size-5 animate-spin" />
              Preparing the local vault workspace...
            </div>
          </div>
        ) : null}

        {mode === "setup" || mode === "locked" ? (
          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="panel-dark rounded-[32px] p-6 sm:p-8">
              {mode === "locked" ? (
                <>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#d8c0a6]">
                    <LockClosedIcon className="size-4" />
                    Session locked
                  </div>
                  <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight">
                    {lockState?.reason === "inactivity"
                      ? "Session closed due to inactivity."
                      : "Vault locked on purpose."}
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-[#e1d4c6]">
                    {lockState?.reason === "inactivity"
                      ? "We sent the vault back to the front door instead of leaving it open while the room went quiet."
                      : "The vault is sealed again and waiting for your master password."}
                  </p>
                  {lockElapsed ? (
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <MetaItem label="Locked" value={`${lockElapsed.compact} ago`} />
                      <MetaItem
                        label="Reason"
                        value={
                          lockState?.reason === "inactivity"
                            ? "Inactivity timeout"
                            : "Manual lock"
                        }
                      />
                    </div>
                  ) : null}
                  <div className="mt-6 grid gap-3">
                    <DarkChecklistItem
                      text={
                        lockElapsed
                          ? `Locked ${lockElapsed.verbose} ago. The timer keeps running so you know exactly how long the vault has been sealed.`
                          : "The vault is sealed and ready for a proper unlock."
                      }
                    />
                    <DarkChecklistItem text={lockHumor} />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="font-display text-3xl font-semibold tracking-tight">
                    A password manager demo with honest security boundaries.
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-[#e1d4c6]">
                    This project keeps secrets encrypted at rest, avoids storing the master
                    password, and exports backups as encrypted JSON instead of raw credentials.
                  </p>
                </>
              )}
            </div>
            <div className="panel-solid rounded-[32px] p-6 sm:p-8">
              {mode === "setup" ? (
                <div className="mb-5 flex items-center gap-2 rounded-full bg-[rgba(19,17,13,0.05)] p-1 text-sm font-semibold text-[#5f5044]">
                  <button
                    type="button"
                    onClick={() => setSetupMode("create")}
                    className={`flex-1 rounded-full px-4 py-2 ${
                      setupMode === "create" ? "bg-[#17120d] text-white" : "hover:bg-white/70"
                    }`}
                  >
                    Create vault
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetupMode("restore")}
                    className={`flex-1 rounded-full px-4 py-2 ${
                      setupMode === "restore" ? "bg-[#17120d] text-white" : "hover:bg-white/70"
                    }`}
                  >
                    Restore backup
                  </button>
                </div>
              ) : null}
              {setupPanel}
            </div>
          </section>
        ) : null}

        {mode === "unlocked" && vault ? (
          <section className="grid min-h-[720px] gap-6 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
            <aside className="grid gap-6">
              <div className="panel-solid rounded-[32px] p-5">
                <div className="grid gap-3">
                  <MetricCard label="Entries" value={String(audit.total)} helper="Saved credentials" />
                  <MetricCard label="Weak" value={String(audit.weakEntries)} helper="Below strong" />
                  <MetricCard label="Reused" value={String(audit.reusedPasswords)} helper="Exact reuse detected" />
                </div>
                <div className="mt-5 rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
                  <label className="grid gap-2 text-sm font-semibold text-[#47392c]">
                    Auto-lock
                    <select
                      value={settings.autoLockMinutes}
                      onChange={(event) => {
                        const next = { autoLockMinutes: Number(event.target.value) };
                        setSettings(next);
                        void saveVaultSettings(next);
                      }}
                      className="rounded-2xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3 text-sm font-medium text-[#17120d]"
                    >
                      {[3, 5, 10, 15].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="panel-glass rounded-[32px] p-5">
                <p className="text-sm uppercase tracking-[0.24em] text-[#7c6349]">Generator</p>
                <p className="mt-3 font-mono text-sm leading-6 break-all text-[#17120d]">{generatedPassword}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setGeneratedPassword(generatePassword(recipe))}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-2 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)]"
                  >
                    <ArrowPathIcon className="size-4" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({ ...current, password: generatedPassword }));
                      setShowDraftPassword(true);
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#17120d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d241b]"
                  >
                    <PlusIcon className="size-4" />
                    Use
                  </button>
                </div>
                <div className="mt-4 grid gap-2">
                  <RecipeToggle
                    label="Uppercase"
                    active={recipe.uppercase}
                    onClick={() =>
                      setRecipe((current) => ({
                        ...current,
                        uppercase:
                          !current.uppercase ||
                          (!current.lowercase && !current.numbers && !current.symbols),
                      }))
                    }
                  />
                  <RecipeToggle
                    label="Lowercase"
                    active={recipe.lowercase}
                    onClick={() =>
                      setRecipe((current) => ({
                        ...current,
                        lowercase:
                          !current.lowercase ||
                          (!current.uppercase && !current.numbers && !current.symbols),
                      }))
                    }
                  />
                  <RecipeToggle
                    label="Numbers"
                    active={recipe.numbers}
                    onClick={() =>
                      setRecipe((current) => ({
                        ...current,
                        numbers:
                          !current.numbers ||
                          (!current.uppercase && !current.lowercase && !current.symbols),
                      }))
                    }
                  />
                  <RecipeToggle
                    label="Symbols"
                    active={recipe.symbols}
                    onClick={() =>
                      setRecipe((current) => ({
                        ...current,
                        symbols:
                          !current.symbols ||
                          (!current.uppercase && !current.lowercase && !current.numbers),
                      }))
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={exportVault}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b]"
                >
                  <ArrowDownTrayIcon className="size-4" />
                  Export encrypted backup
                </button>
                <button
                  type="button"
                  onClick={() =>
                    lockVault({
                      message: "Vault locked manually.",
                    })
                  }
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)]"
                >
                  <LockClosedIcon className="size-4" />
                  Lock vault
                </button>
              </div>
            </aside>

            <div className="panel-glass flex min-h-[720px] flex-col rounded-[32px] p-5">
              <div className="flex flex-col gap-4 border-b border-[rgba(19,17,13,0.08)] pb-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-display text-3xl font-semibold tracking-tight text-[#17120d]">
                  Vault catalog
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setDraft(createDraft(generatedPassword));
                    setShowDraftPassword(true);
                  }}
                  className="flex items-center justify-center gap-2 rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b]"
                >
                  <PlusIcon className="size-4" />
                  New entry
                </button>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/72 px-4 py-3">
                <MagnifyingGlassIcon className="size-4 text-[#7c6349]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, username, site, or tags"
                  className="w-full bg-transparent text-sm text-[#17120d] placeholder:text-[#8a7a68] focus:outline-none"
                />
              </div>
              <div className="app-scrollbar mt-5 flex-1 overflow-y-auto">
                <div className="grid gap-3">
                  {filteredEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(entry.id);
                        setDraft(entryToDraft(entry));
                        setShowDraftPassword(false);
                      }}
                      className={`rounded-[28px] border p-4 text-left ${
                        entry.id === selectedId
                          ? "border-[rgba(15,125,123,0.32)] bg-[rgba(15,125,123,0.08)]"
                          : "border-[rgba(19,17,13,0.08)] bg-white/72"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold text-[#17120d]">
                              {entry.title}
                            </span>
                            {entry.favorite ? (
                              <StarSolidIcon className="size-4 text-[#db8f34]" />
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm text-[#5f5044]">
                            {entry.username}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-[0.2em] text-[#8a7a68]">
                          {formatRelative(entry.updatedAt)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {filteredEntries.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-[rgba(19,17,13,0.16)] bg-white/60 p-8 text-center text-[#5f5044]">
                      No entries match the current search.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="panel-solid flex min-h-[720px] flex-col rounded-[32px] p-5">
              <div className="flex items-start justify-between border-b border-[rgba(19,17,13,0.08)] pb-5">
                <h2 className="font-display text-3xl font-semibold tracking-tight text-[#17120d]">
                  {selectedEntry ? "Update credential" : "Create a new credential"}
                </h2>
                <FavoriteToggle
                  active={draft.favorite}
                  onClick={() =>
                    setDraft((current) => ({ ...current, favorite: !current.favorite }))
                  }
                />
              </div>
              <form className="app-scrollbar mt-5 flex-1 overflow-y-auto pr-1" onSubmit={saveEntry}>
                <div className="grid gap-4">
                  <TextField
                    label="Entry title"
                    placeholder="e.g. GitHub personal"
                    value={draft.title}
                    onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                  />
                  <TextField
                    label="Username or email"
                    placeholder="name@example.com"
                    value={draft.username}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, username: value }))
                    }
                  />
                  <SecureInput
                    label="Password"
                    value={draft.password}
                    onChange={(value) => setDraft((current) => ({ ...current, password: value }))}
                    placeholder="Paste or generate a password"
                    visible={showDraftPassword}
                    onToggleVisibility={() => setShowDraftPassword((current) => !current)}
                  />
                  <ScoreCard
                    label="Current password strength"
                    score={draftStrength.score}
                    toneLabel={draftStrength.label}
                    feedback={draftStrength.feedback}
                  />
                  <TextField
                    label="Website"
                    placeholder="github.com"
                    value={draft.website}
                    onChange={(value) => setDraft((current) => ({ ...current, website: value }))}
                  />
                  <TextField
                    label="Tags"
                    placeholder="work, personal, 2fa"
                    value={draft.tagsText}
                    onChange={(value) => setDraft((current) => ({ ...current, tagsText: value }))}
                  />
                  <TextAreaField
                    label="Notes"
                    placeholder="Optional local notes"
                    value={draft.notes}
                    onChange={(value) => setDraft((current) => ({ ...current, notes: value }))}
                  />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
                  >
                    {saving ? (
                      <ArrowPathIcon className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheckIcon className="size-4" />
                    )}
                    {selectedEntry ? "Save changes" : "Add to vault"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(draft.username)}
                    disabled={!draft.username}
                    className="flex items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-45"
                  >
                    <DocumentDuplicateIcon className="size-4" />
                    Copy user
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(draft.password)}
                    disabled={!draft.password}
                    className="flex items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-45"
                  >
                    <DocumentDuplicateIcon className="size-4" />
                    Copy password
                  </button>
                  {selectedEntry ? (
                    <button
                      type="button"
                      onClick={deleteEntry}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 rounded-full border border-[rgba(164,67,44,0.16)] px-4 py-3 text-sm font-semibold text-[#8f3824] hover:bg-[rgba(164,67,44,0.06)] disabled:opacity-45"
                    >
                      <TrashIcon className="size-4" />
                      Delete
                    </button>
                  ) : null}
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
