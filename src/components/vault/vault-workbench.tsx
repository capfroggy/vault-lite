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
import {
  createBackupBundle,
  createBackupFileName,
  getBackupErrorMessage,
  mergeVaults,
  parseBackupBundle,
  summarizeImportedVault,
  type ImportedVaultSummary,
  type VaultMergePlan,
} from "@/lib/backup";
import {
  CLIPBOARD_AUTO_CLEAR_MS,
  clearClipboardIfOwned,
  formatClipboardCountdown,
  getClipboardFieldLabel,
  type ClipboardAutoClearResult,
  type ClipboardField,
} from "@/lib/clipboard/session-clipboard";
import {
  createEncryptedVault,
  PBKDF2_ITERATIONS,
  sealVault,
  unlockVault,
} from "@/lib/crypto/vault-crypto";
import { auditVault, filterVaultEntryAudits } from "@/lib/password/audit";
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
  type VaultCustomField,
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
type RiskFilter = "all" | "critical" | "weak" | "reused" | "favorites";
type NoticeTone = "error" | "info" | "success";
type Notice = { detail: string; tone: NoticeTone };
type LockState = { lockedAt: string; reason: LockReason };
type ImportMode = "merge" | "replace";
type DraftCustomField = {
  id: string;
  label: string;
  value: string;
};
type BackupPreview = ImportedVaultSummary & {
  fileName: string;
  mode: ImportMode;
  record: EncryptedVaultRecord;
  vault: Vault;
  mergePlan?: VaultMergePlan;
};
type ClipboardFeedbackTone = "error" | "info" | "success" | "warning";
type ClipboardFeedbackStatus = "active" | "cleared" | "error" | "skipped" | "unsupported";
type ClipboardFeedback = {
  clearAt?: number;
  detail: string;
  field: ClipboardField;
  status: ClipboardFeedbackStatus;
  tone: ClipboardFeedbackTone;
};
type EntryDraft = {
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  tagsText: string;
  customFields: DraftCustomField[];
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
  customFields: [],
  favorite: false,
};

const noticeStyles: Record<NoticeTone, string> = {
  error: "border-[rgba(164,67,44,0.18)] bg-[rgba(164,67,44,0.08)] text-[#8f3824]",
  info: "border-[rgba(15,125,123,0.18)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]",
  success: "border-[rgba(23,107,78,0.18)] bg-[rgba(23,107,78,0.08)] text-[#175941]",
};

const clipboardFeedbackStyles: Record<ClipboardFeedbackTone, string> = {
  error: "border-[rgba(164,67,44,0.18)] bg-[rgba(164,67,44,0.08)] text-[#8f3824]",
  info: "border-[rgba(15,125,123,0.18)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]",
  success: "border-[rgba(23,107,78,0.18)] bg-[rgba(23,107,78,0.08)] text-[#175941]",
  warning: "border-[rgba(185,126,48,0.22)] bg-[rgba(185,126,48,0.1)] text-[#7d5314]",
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
    customFields: entry.customFields.map((field) => ({ ...field })),
    favorite: entry.favorite,
  };
}

function createDraftCustomField(): DraftCustomField {
  return {
    id: crypto.randomUUID(),
    label: "",
    value: "",
  };
}

function normalizeDraftCustomFields(fields: DraftCustomField[]): VaultCustomField[] {
  return fields
    .map((field) => ({
      id: field.id || crypto.randomUUID(),
      label: field.label.trim(),
      value: field.value.trim(),
    }))
    .filter((field) => field.label && field.value)
    .slice(0, 6);
}

function customFieldsEqual(left: VaultCustomField[], right: VaultCustomField[]) {
  return (
    left.length === right.length &&
    left.every(
      (field, index) =>
        field.label === right[index]?.label && field.value === right[index]?.value,
    )
  );
}

function buildChangedFields(previous: VaultEntry, next: VaultEntry) {
  const changedFields: string[] = [];

  if (previous.title !== next.title) changedFields.push("title");
  if (previous.username !== next.username) changedFields.push("username");
  if (previous.password !== next.password) changedFields.push("password");
  if (previous.website !== next.website) changedFields.push("website");
  if (previous.notes !== next.notes) changedFields.push("notes");
  if (previous.favorite !== next.favorite) changedFields.push("favorite");
  if (previous.tags.join("|") !== next.tags.join("|")) changedFields.push("tags");
  if (!customFieldsEqual(previous.customFields, next.customFields)) {
    changedFields.push("custom fields");
  }

  return changedFields;
}

function buildHistorySummary(action: "created" | "updated", title: string, changedFields: string[]) {
  if (action === "created") {
    return `Created credential for ${title}.`;
  }

  if (changedFields.length === 1) {
    return `Updated ${changedFields[0]} for ${title}.`;
  }

  return `Updated ${changedFields.slice(0, 3).join(", ")} for ${title}.`;
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
    customFields: normalizeDraftCustomFields(draft.customFields),
    history: existing?.history ?? [],
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

function buildActiveClipboardMessage(field: ClipboardField, countdown: string) {
  return `${getClipboardFieldLabel(field)} copied. VaultLite will try to clear it in ${countdown} if nothing else has replaced it.`;
}

function buildFinishedClipboardMessage(
  field: ClipboardField,
  result: ClipboardAutoClearResult,
) {
  const label = getClipboardFieldLabel(field);

  if (result === "cleared") {
    return {
      detail: `${label} cleared from the clipboard. The lurking keyboard goblins will have to find a new hobby.`,
      tone: "success" as const,
    };
  }

  if (result === "skipped") {
    return {
      detail: `${label} timer finished, but the clipboard had already changed, so VaultLite left it alone.`,
      tone: "info" as const,
    };
  }

  return {
    detail: `${label} timer finished, but this browser would not allow a safe clipboard wipe.`,
    tone: "warning" as const,
  };
}

function matchesAuditQuery(
  value: string,
  query: string,
  warnings: string[],
) {
  if (!query) {
    return true;
  }

  return value.toLowerCase().includes(query) || warnings.join(" ").toLowerCase().includes(query);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function getRiskBadgeClasses(flag: "weak" | "reused") {
  return flag === "weak"
    ? "border-[rgba(185,126,48,0.22)] bg-[rgba(185,126,48,0.12)] text-[#7d5314]"
    : "border-[rgba(164,67,44,0.18)] bg-[rgba(164,67,44,0.08)] text-[#8f3824]";
}

function BackupPreviewPanel({
  preview,
  context,
}: {
  preview: BackupPreview;
  context: "restore" | "import";
}) {
  return (
    <div className="rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#47392c]">Backup preview ready</p>
          <p className="mt-1 text-sm text-[#5f5044]">{preview.fileName}</p>
        </div>
        <span className="rounded-full border border-[rgba(15,125,123,0.18)] bg-[rgba(15,125,123,0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f5f5d]">
          {preview.mode === "merge" ? "Merge mode" : "Replace mode"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MetaItem label="Exported" value={formatDateTime(preview.exportedAt)} />
        <MetaItem label="Vault updated" value={formatDateTime(preview.updatedAt)} />
        <MetaItem
          label="Entries"
          value={`${preview.entryCount} total / ${preview.favorites} favorites`}
        />
        <MetaItem
          label="Risk scan"
          value={`${preview.weakEntries} weak / ${preview.reusedPasswordGroups} reuse groups`}
        />
      </div>
      {preview.mergePlan ? (
        <div className="mt-4 rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white px-4 py-4 text-sm text-[#5f5044]">
          <p className="font-semibold text-[#17120d]">Merge outcome preview</p>
          <p className="mt-2 leading-6">
            {preview.mergePlan.added} new entries will be added, {preview.mergePlan.replaced} newer
            matches will replace existing ones, and {preview.mergePlan.unchanged} current entries
            already beat or match the imported version.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8a7a68]">
            Resulting vault size: {preview.mergePlan.resultingCount} entries
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-3xl border border-[rgba(185,126,48,0.22)] bg-[rgba(185,126,48,0.1)] px-4 py-4 text-sm text-[#7d5314]">
          {context === "restore"
            ? "Applying this backup replaces the local encrypted vault stored on this device."
            : "Replacing switches the current session to the imported encrypted vault and keeps that backup's original master password."}
        </div>
      )}
    </div>
  );
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
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importPreview, setImportPreview] = useState<BackupPreview | null>(null);
  const [showMaster, setShowMaster] = useState(false);
  const [showDraftPassword, setShowDraftPassword] = useState(false);
  const [recipe, setRecipe] = useState<PasswordRecipe>(DEFAULT_RECIPE);
  const [generatedPassword, setGeneratedPassword] = useState(() =>
    generatePassword(DEFAULT_RECIPE),
  );
  const [clipboardFeedback, setClipboardFeedback] = useState<ClipboardFeedback | null>(null);
  const [clipboardClock, setClipboardClock] = useState(() => Date.now());
  const keyRef = useRef<CryptoKey | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const entryFormRef = useRef<HTMLFormElement | null>(null);
  const clipboardTimerRef = useRef<number | null>(null);
  const clipboardTickerRef = useRef<number | null>(null);
  const clipboardSessionRef = useRef<{
    clearAt: number;
    field: ClipboardField;
    value: string;
  } | null>(null);

  const entries = vault?.entries ?? [];
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const audit = auditVault(entries);
  const filteredEntryAudits = filterVaultEntryAudits(audit.entries, {
    favoritesOnly: riskFilter === "favorites",
    weakOnly: riskFilter === "weak" || riskFilter === "critical",
    reusedOnly: riskFilter === "reused" || riskFilter === "critical",
  }).filter((entryAudit) =>
    matchesAuditQuery(
      [
        entryAudit.entry.title,
        entryAudit.entry.username,
        entryAudit.entry.website,
        entryAudit.entry.notes,
        entryAudit.entry.tags.join(" "),
        entryAudit.entry.customFields
          .map((field) => `${field.label} ${field.value}`)
          .join(" "),
      ].join(" "),
      query,
      entryAudit.warnings,
    ),
  );
  const selectedEntryAudit =
    audit.entries.find((entryAudit) => entryAudit.entry.id === selectedId) ?? null;
  const masterStrength = assessPasswordStrength(setupPassword);
  const draftStrength = assessPasswordStrength(draft.password);
  const lockElapsed = lockState ? formatElapsedSince(lockState.lockedAt, lockClock) : null;
  const lockHumor = buildLockHumor(lockState, lockElapsed?.verbose ?? "a while");
  const reusedEntryCount = audit.entries.filter((entryAudit) =>
    entryAudit.flags.includes("reused"),
  ).length;
  const criticalEntryCount = audit.entries.filter(
    (entryAudit) =>
      entryAudit.flags.includes("weak") && entryAudit.flags.includes("reused"),
  ).length;
  const riskFilterCounts: Record<RiskFilter, number> = {
    all: audit.entries.length,
    critical: criticalEntryCount,
    weak: audit.weakEntries,
    reused: reusedEntryCount,
    favorites: audit.favorites,
  };
  const clipboardCountdown =
    clipboardFeedback?.status === "active" && clipboardFeedback.clearAt
      ? formatClipboardCountdown(Math.max(clipboardFeedback.clearAt - clipboardClock, 0))
      : null;
  const clipboardMessage = clipboardFeedback
    ? clipboardFeedback.status === "active" && clipboardCountdown
      ? buildActiveClipboardMessage(clipboardFeedback.field, clipboardCountdown)
      : clipboardFeedback.detail
    : null;
  const copyUserLabel =
    clipboardFeedback?.field === "username" &&
    clipboardFeedback.status === "active" &&
    clipboardCountdown
      ? `Copied ${clipboardCountdown}`
      : "Copy user";
  const copyPasswordLabel =
    clipboardFeedback?.field === "password" &&
    clipboardFeedback.status === "active" &&
    clipboardCountdown
      ? `Copied ${clipboardCountdown}`
      : "Copy password";

  const startNewEntry = useCallback(() => {
    setSelectedId(null);
    setDraft(createDraft(generatedPassword));
    setShowDraftPassword(true);
  }, [generatedPassword]);

  const addCustomFieldRow = useCallback(() => {
    setDraft((current) => ({
      ...current,
      customFields: [...current.customFields, createDraftCustomField()].slice(0, 6),
    }));
  }, []);

  const updateCustomFieldRow = useCallback(
    (fieldId: string, key: "label" | "value", value: string) => {
      setDraft((current) => ({
        ...current,
        customFields: current.customFields.map((field) =>
          field.id === fieldId ? { ...field, [key]: value } : field,
        ),
      }));
    },
    [],
  );

  const removeCustomFieldRow = useCallback((fieldId: string) => {
    setDraft((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== fieldId),
    }));
  }, []);

  const clearClipboardTimers = useCallback(() => {
    if (clipboardTimerRef.current) {
      window.clearTimeout(clipboardTimerRef.current);
      clipboardTimerRef.current = null;
    }

    if (clipboardTickerRef.current) {
      window.clearInterval(clipboardTickerRef.current);
      clipboardTickerRef.current = null;
    }
  }, []);

  const resetClipboardFeedback = useCallback(() => {
    clearClipboardTimers();
    clipboardSessionRef.current = null;
    setClipboardFeedback(null);
  }, [clearClipboardTimers]);

  const completeClipboardAutoClear = useCallback(async () => {
    const session = clipboardSessionRef.current;

    clearClipboardTimers();

    if (!session) {
      return;
    }

    clipboardSessionRef.current = null;
    setClipboardClock(Date.now());

    const result = await clearClipboardIfOwned(navigator.clipboard, session.value);
    const feedback = buildFinishedClipboardMessage(session.field, result);

    setClipboardFeedback({
      detail: feedback.detail,
      field: session.field,
      status: result,
      tone: feedback.tone,
    });
  }, [clearClipboardTimers]);

  const copyFieldToClipboard = useCallback(
    async (field: ClipboardField, value: string) => {
      if (!value) {
        return;
      }

      const label = getClipboardFieldLabel(field);

      clearClipboardTimers();
      clipboardSessionRef.current = null;

      if (!navigator.clipboard?.writeText) {
        setClipboardFeedback({
          detail: `${label} could not be copied because this browser does not expose the Clipboard API.`,
          field,
          status: "error",
          tone: "error",
        });
        return;
      }

      try {
        await navigator.clipboard.writeText(value);

        const copiedAt = Date.now();
        const clearAt = copiedAt + CLIPBOARD_AUTO_CLEAR_MS;

        clipboardSessionRef.current = { clearAt, field, value };
        setClipboardClock(copiedAt);
        setClipboardFeedback({
          clearAt,
          detail: "",
          field,
          status: "active",
          tone: "success",
        });

        clipboardTickerRef.current = window.setInterval(() => {
          setClipboardClock(Date.now());
        }, 1000);

        clipboardTimerRef.current = window.setTimeout(() => {
          void completeClipboardAutoClear();
        }, CLIPBOARD_AUTO_CLEAR_MS);
      } catch {
        setClipboardFeedback({
          detail: `${label} could not be copied. The browser blocked clipboard access.`,
          field,
          status: "error",
          tone: "error",
        });
      }
    },
    [clearClipboardTimers, completeClipboardAutoClear],
  );

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
      resetClipboardFeedback();
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
    [record, resetClipboardFeedback],
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
    return () => {
      resetClipboardFeedback();
    };
  }, [resetClipboardFeedback]);

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

  useEffect(() => {
    if (mode !== "unlocked") {
      return;
    }

    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        entryFormRef.current?.requestSubmit();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        lockVault({
          message: "Vault locked manually.",
        });
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewEntry();
      }
    };

    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [lockVault, mode, startNewEntry]);

  useEffect(() => {
    setRestorePreview(null);
  }, [restoreFile, restorePassword]);

  useEffect(() => {
    setImportPreview(null);
  }, [importFile, importMode, importPassword, vault?.updatedAt]);

  const hydrateDraftFromVault = useCallback(
    (nextVault: Vault, preferredId?: string | null) => {
      const nextSelected =
        (preferredId
          ? nextVault.entries.find((entry) => entry.id === preferredId) ?? null
          : null) ?? nextVault.entries[0] ?? null;

      if (nextSelected) {
        setSelectedId(nextSelected.id);
        setDraft(entryToDraft(nextSelected));
        return;
      }

      setSelectedId(null);
      setDraft(createDraft(generatedPassword));
    },
    [generatedPassword],
  );

  const buildBackupPreview = useCallback(
    async ({
      currentVault,
      file,
      mode,
      password,
    }: {
      currentVault?: Vault | null;
      file: File;
      mode: ImportMode;
      password: string;
    }): Promise<BackupPreview> => {
      if (!password.trim()) {
        throw new Error("Enter the backup master password first.");
      }

      const bundle = parseBackupBundle(await file.text());
      const opened = await unlockVault(password, bundle.vault);
      const summary = summarizeImportedVault(bundle, opened.vault);

      return {
        ...summary,
        fileName: file.name,
        mode,
        record: bundle.vault,
        vault: opened.vault,
        ...(mode === "merge" && currentVault ? { mergePlan: mergeVaults(currentVault, opened.vault) } : {}),
      };
    },
    [],
  );

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
      hydrateDraftFromVault(created.vault);
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
      hydrateDraftFromVault(opened.vault);
      setNotice({ tone: "success", detail: "Vault unlocked." });
    } catch (error) {
      setNotice({ tone: "error", detail: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function previewRestore() {
    if (!restoreFile) {
      setNotice({ tone: "error", detail: "Choose a backup file first." });
      return;
    }

    setBusy(true);
    try {
      const preview = await buildBackupPreview({
        file: restoreFile,
        mode: "replace",
        password: restorePassword,
      });

      setRestorePreview(preview);
      setNotice({
        tone: "info",
        detail: "Backup preview ready. Restoring it will replace the local vault on this device.",
      });
    } catch (error) {
      setRestorePreview(null);
      setNotice({ tone: "error", detail: getBackupErrorMessage(error) });
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
      const preview =
        restorePreview ??
        (await buildBackupPreview({
          file: restoreFile,
          mode: "replace",
          password: restorePassword,
        }));
      const opened = await unlockVault(restorePassword, preview.record);
      await saveEncryptedVault(preview.record);
      keyRef.current = opened.key;
      setRecord(preview.record);
      setLockState(null);
      setVault(opened.vault);
      setMode("unlocked");
      hydrateDraftFromVault(opened.vault);
      setRestoreFile(null);
      setRestorePassword("");
      setRestorePreview(null);
      setNotice({
        tone: "success",
        detail: `Backup restored successfully with ${opened.vault.entries.length} encrypted entries.`,
      });
    } catch (error) {
      setNotice({ tone: "error", detail: getBackupErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vault) return;
    setSaving(true);
    try {
      const baseEntry = buildEntryFromDraft(draft, selectedEntry ?? undefined);
      const nextEntry = selectedEntry
        ? (() => {
            const changedFields = buildChangedFields(selectedEntry, baseEntry);

            if (changedFields.length === 0) {
              return null;
            }

            return entrySchema.parse({
              ...baseEntry,
              history: [
                ...selectedEntry.history,
                {
                  id: crypto.randomUUID(),
                  changedAt: baseEntry.updatedAt,
                  action: "updated",
                  changedFields,
                  summary: buildHistorySummary("updated", baseEntry.title, changedFields),
                },
              ].slice(-20),
            });
          })()
        : entrySchema.parse({
            ...baseEntry,
            history: [
              {
                id: crypto.randomUUID(),
                changedAt: baseEntry.updatedAt,
                action: "created",
                changedFields: ["title", "username", "password"],
                summary: buildHistorySummary("created", baseEntry.title, []),
              },
            ],
          });

      if (!nextEntry) {
        setNotice({ tone: "info", detail: "No changes to save yet." });
        return;
      }

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

  async function previewImport() {
    if (!vault) {
      setNotice({ tone: "error", detail: "Unlock the vault before importing another backup." });
      return;
    }

    if (!importFile) {
      setNotice({ tone: "error", detail: "Choose a backup file to import first." });
      return;
    }

    setBusy(true);
    try {
      const preview = await buildBackupPreview({
        currentVault: vault,
        file: importFile,
        mode: importMode,
        password: importPassword,
      });

      setImportPreview(preview);
      setNotice({
        tone: "info",
        detail:
          importMode === "merge"
            ? "Import preview ready. Review the merge outcome before resealing the current vault."
            : "Import preview ready. Applying replace mode will switch this session to the imported backup.",
      });
    } catch (error) {
      setImportPreview(null);
      setNotice({ tone: "error", detail: getBackupErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!vault) {
      setNotice({ tone: "error", detail: "Unlock the vault before importing another backup." });
      return;
    }

    if (!importFile) {
      setNotice({ tone: "error", detail: "Choose a backup file to import first." });
      return;
    }

    setBusy(true);
    try {
      const preview =
        importPreview ??
        (await buildBackupPreview({
          currentVault: vault,
          file: importFile,
          mode: importMode,
          password: importPassword,
        }));

      if (importMode === "replace") {
        const opened = await unlockVault(importPassword, preview.record);
        await saveEncryptedVault(preview.record);
        keyRef.current = opened.key;
        setRecord(preview.record);
        setLockState(null);
        setVault(opened.vault);
        hydrateDraftFromVault(opened.vault);
        setImportFile(null);
        setImportPassword("");
        setImportPreview(null);
        setImportMode("merge");
        setNotice({
          tone: "success",
          detail: `Imported backup replaced the current vault with ${opened.vault.entries.length} encrypted entries.`,
        });
        return;
      }

      const mergePlan = preview.mergePlan ?? mergeVaults(vault, preview.vault);
      const persisted = await persistVault(mergePlan.vault);
      setVault(persisted);
      hydrateDraftFromVault(persisted, selectedId);
      setImportFile(null);
      setImportPassword("");
      setImportPreview(null);
      setImportMode("merge");
      setNotice({
        tone: "success",
        detail: `Merge complete: ${mergePlan.added} added, ${mergePlan.replaced} refreshed, ${mergePlan.unchanged} left untouched.`,
      });
    } catch (error) {
      setNotice({ tone: "error", detail: getBackupErrorMessage(error) });
    } finally {
      setBusy(false);
    }
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
            <FileDropRow
              fileName={restoreFile?.name ?? null}
              helperText="Choose an encrypted VaultLite backup. Preview decrypts it locally before any replacement happens."
              inputId="restore-backup-file"
              onChange={setRestoreFile}
            />
          </div>
          <SecureInput
            label="Master password"
            value={restorePassword}
            onChange={setRestorePassword}
            placeholder="Password used for the backup"
            visible={showMaster}
            onToggleVisibility={() => setShowMaster((current) => !current)}
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void previewRestore()}
              disabled={busy}
              className="flex-1 rounded-full border border-[rgba(19,17,13,0.12)] px-5 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-60"
            >
              {busy ? "Decrypting..." : "Preview backup"}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-full bg-[#17120d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
            >
              {busy ? "Restoring..." : "Replace local vault"}
            </button>
          </div>
          {restorePreview ? (
            <BackupPreviewPanel context="restore" preview={restorePreview} />
          ) : (
            <p className="text-sm leading-6 text-[#5f5044]">
              Preview first if you want to verify the backup before replacing the local encrypted
              vault on this browser.
            </p>
          )}
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
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${noticeStyles[notice.tone]}`}
          >
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
                  <div className="mt-6 grid gap-3">
                    <DarkChecklistItem text="1. Create a master password with enough length to survive both boredom and brute force." />
                    <DarkChecklistItem text="2. Add your first credential, tag it, and let the generator handle the ugly password work." />
                    <DarkChecklistItem text="3. Export an encrypted backup once the vault looks useful, not five minutes after panic hits." />
                  </div>
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
                  <MetricCard label="Weak" value={String(audit.weakEntries)} helper="Needs a stronger password" />
                  <MetricCard label="Reused" value={String(reusedEntryCount)} helper="Entries affected by reuse" />
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
                <div className="mt-4 rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
                  <p className="text-sm font-semibold text-[#47392c]">Risk pulse</p>
                  <p className="mt-2 text-sm leading-6 text-[#5f5044]">
                    {criticalEntryCount > 0
                      ? `${criticalEntryCount} entries are both weak and reused. Those should be the first cleanup target.`
                      : reusedEntryCount > 0
                        ? "There is reuse in the vault, but no critical weak-and-reused combo right now."
                        : "No password reuse detected. The goblins are disappointed."}
                  </p>
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
                <div className="mt-4 rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
                  <p className="text-sm font-semibold text-[#47392c]">Import encrypted backup</p>
                  <p className="mt-2 text-sm leading-6 text-[#5f5044]">
                    Preview another backup locally, then merge it into the current vault or replace
                    this session with it.
                  </p>
                  <div className="mt-4 grid gap-3">
                    <FileDropRow
                      fileName={importFile?.name ?? null}
                      helperText="VaultLite only accepts encrypted JSON backups here. Preview decrypts locally before anything is merged or replaced."
                      inputId="import-backup-file"
                      onChange={setImportFile}
                    />
                    <SecureInput
                      label="Backup password"
                      value={importPassword}
                      onChange={setImportPassword}
                      placeholder="Password used for the imported backup"
                      visible={showMaster}
                      onToggleVisibility={() => setShowMaster((current) => !current)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ["merge", "Merge"],
                          ["replace", "Replace"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={importMode === value}
                          onClick={() => setImportMode(value)}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                            importMode === value
                              ? "border-[rgba(15,125,123,0.24)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]"
                              : "border-[rgba(19,17,13,0.12)] bg-white text-[#47392c] hover:bg-[rgba(19,17,13,0.04)]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void previewImport()}
                        disabled={busy}
                        className="flex-1 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-60"
                      >
                        {busy ? "Decrypting..." : "Preview import"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void applyImport()}
                        disabled={busy}
                        className="flex-1 rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b] disabled:opacity-60"
                      >
                        {busy
                          ? importMode === "merge"
                            ? "Merging..."
                            : "Replacing..."
                          : importMode === "merge"
                            ? "Apply merge"
                            : "Apply replace"}
                      </button>
                    </div>
                    {importPreview ? (
                      <BackupPreviewPanel context="import" preview={importPreview} />
                    ) : (
                      <p className="text-sm leading-6 text-[#5f5044]">
                        Merge keeps the current master password and reseals everything with the
                        open session key. Replace switches the session to the imported encrypted
                        backup.
                      </p>
                    )}
                  </div>
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
                  aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)]"
                >
                  <LockClosedIcon className="size-4" />
                  Lock vault
                </button>
              </div>

              <div className="panel-solid rounded-[32px] p-5">
                <p className="text-sm uppercase tracking-[0.24em] text-[#7c6349]">Shortcuts</p>
                <div className="mt-4 grid gap-3 text-sm text-[#5f5044]">
                  <div className="flex items-center justify-between rounded-2xl bg-white/72 px-4 py-3">
                    <span>Focus search</span>
                    <span className="font-mono text-xs text-[#17120d]">/</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-white/72 px-4 py-3">
                    <span>New entry</span>
                    <span className="font-mono text-xs text-[#17120d]">N</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-white/72 px-4 py-3">
                    <span>Save entry</span>
                    <span className="font-mono text-xs text-[#17120d]">Ctrl/Cmd + S</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-white/72 px-4 py-3">
                    <span>Lock vault</span>
                    <span className="font-mono text-xs text-[#17120d]">Ctrl/Cmd + Shift + L</span>
                  </div>
                </div>
              </div>
            </aside>

            <div className="panel-glass flex min-h-[720px] flex-col rounded-[32px] p-5">
              <div className="flex flex-col gap-4 border-b border-[rgba(19,17,13,0.08)] pb-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-display text-3xl font-semibold tracking-tight text-[#17120d]">
                  Vault catalog
                </h2>
                <button
                  type="button"
                  onClick={startNewEntry}
                  aria-keyshortcuts="N"
                  className="flex items-center justify-center gap-2 rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b]"
                >
                  <PlusIcon className="size-4" />
                  New entry
                </button>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-[28px] border border-[rgba(19,17,13,0.08)] bg-white/72 px-4 py-3">
                <MagnifyingGlassIcon className="size-4 text-[#7c6349]" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, username, site, or tags"
                  aria-label="Search vault entries"
                  className="w-full bg-transparent text-sm text-[#17120d] placeholder:text-[#8a7a68] focus:outline-none"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["critical", "Critical"],
                    ["weak", "Weak"],
                    ["reused", "Reused"],
                    ["favorites", "Favorites"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={riskFilter === value}
                    onClick={() => setRiskFilter(value)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                      riskFilter === value
                        ? "border-[rgba(15,125,123,0.24)] bg-[rgba(15,125,123,0.08)] text-[#0f5f5d]"
                        : "border-[rgba(19,17,13,0.12)] bg-white/72 text-[#47392c] hover:bg-[rgba(19,17,13,0.04)]"
                    }`}
                  >
                    {label} {riskFilterCounts[value]}
                  </button>
                ))}
              </div>
              <div className="app-scrollbar mt-5 flex-1 overflow-y-auto">
                <div className="grid gap-3">
                  {filteredEntryAudits.map((entryAudit) => (
                    <button
                      key={entryAudit.entry.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(entryAudit.entry.id);
                        setDraft(entryToDraft(entryAudit.entry));
                        setShowDraftPassword(false);
                      }}
                      className={`rounded-[28px] border p-4 text-left ${
                        entryAudit.entry.id === selectedId
                          ? "border-[rgba(15,125,123,0.32)] bg-[rgba(15,125,123,0.08)]"
                          : "border-[rgba(19,17,13,0.08)] bg-white/72"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold text-[#17120d]">
                              {entryAudit.entry.title}
                            </span>
                            {entryAudit.entry.favorite ? (
                              <StarSolidIcon className="size-4 text-[#db8f34]" />
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {entryAudit.flags.map((flag) => (
                              <span
                                key={`${entryAudit.entry.id}-${flag}`}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getRiskBadgeClasses(flag)}`}
                              >
                                {flag === "weak" ? "Weak" : `Reused x${entryAudit.duplicateCount}`}
                              </span>
                            ))}
                          </div>
                          <p className="mt-1 truncate text-sm text-[#5f5044]">
                            {entryAudit.entry.username}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-[0.2em] text-[#8a7a68]">
                          {formatRelative(entryAudit.entry.updatedAt)}
                        </span>
                      </div>
                    </button>
                  ))}
                  {filteredEntryAudits.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-[rgba(19,17,13,0.16)] bg-white/60 p-8 text-center text-[#5f5044]">
                      {entries.length === 0 ? (
                        <div className="mx-auto max-w-md">
                          <p className="font-display text-2xl font-semibold tracking-tight text-[#17120d]">
                            Your vault is empty, which is secure but not especially useful.
                          </p>
                          <p className="mt-3 text-sm leading-6">
                            Start with one credential, tag it, and let the generator create a fresh password while you get the feel for the flow.
                          </p>
                          <div className="mt-5 flex flex-wrap justify-center gap-3">
                            <button
                              type="button"
                              onClick={startNewEntry}
                              className="rounded-full bg-[#17120d] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2d241b]"
                            >
                              Create first entry
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                setRiskFilter("all");
                              }}
                              className="rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)]"
                            >
                              Reset filters
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mx-auto max-w-md">
                          <p className="font-semibold text-[#17120d]">
                            No entries match the current search and risk filters.
                          </p>
                          <p className="mt-3 text-sm leading-6">
                            Try another term, clear the current filter, or jump to the riskiest entries with the `Critical` chip.
                          </p>
                        </div>
                      )}
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
              <form
                ref={entryFormRef}
                className="app-scrollbar mt-5 flex-1 overflow-y-auto pr-1"
                onSubmit={saveEntry}
              >
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
                  {selectedEntryAudit?.warnings.length ? (
                    <div className="rounded-3xl border border-[rgba(164,67,44,0.16)] bg-[rgba(164,67,44,0.05)] p-4">
                      <p className="text-sm font-semibold text-[#8f3824]">Risk warnings</p>
                      <div className="mt-3 grid gap-2 text-sm text-[#6b3d31]">
                        {selectedEntryAudit.warnings.map((warning) => (
                          <div key={warning} className="flex items-start gap-2">
                            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
                            <span>{warning}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
                  <div className="grid gap-3 rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#47392c]">Custom fields</p>
                        <p className="mt-1 text-sm text-[#5f5044]">
                          Add OTP hints, recovery phrases, account IDs, or any extra metadata worth encrypting.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addCustomFieldRow}
                        disabled={draft.customFields.length >= 6}
                        className="rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-2 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-45"
                      >
                        Add field
                      </button>
                    </div>
                    {draft.customFields.length > 0 ? (
                      <div className="grid gap-3">
                        {draft.customFields.map((field) => (
                          <div
                            key={field.id}
                            className="grid gap-3 rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white px-4 py-4"
                          >
                            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                              <input
                                value={field.label}
                                onChange={(event) =>
                                  updateCustomFieldRow(field.id, "label", event.target.value)
                                }
                                placeholder="Field label"
                                className="rounded-2xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3 text-sm text-[#17120d] placeholder:text-[#8a7a68]"
                              />
                              <input
                                value={field.value}
                                onChange={(event) =>
                                  updateCustomFieldRow(field.id, "value", event.target.value)
                                }
                                placeholder="Encrypted value"
                                className="rounded-2xl border border-[rgba(19,17,13,0.12)] bg-white px-4 py-3 text-sm text-[#17120d] placeholder:text-[#8a7a68]"
                              />
                              <button
                                type="button"
                                onClick={() => removeCustomFieldRow(field.id)}
                                className="rounded-full border border-[rgba(164,67,44,0.16)] px-4 py-3 text-sm font-semibold text-[#8f3824] hover:bg-[rgba(164,67,44,0.06)]"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-[rgba(19,17,13,0.16)] bg-white px-4 py-5 text-sm text-[#5f5044]">
                        No custom fields yet. This is a good place for customer IDs, backup codes, security question hints, or anything too annoying to lose.
                      </div>
                    )}
                  </div>
                  {selectedEntry?.history.length ? (
                    <div className="rounded-3xl border border-[rgba(19,17,13,0.08)] bg-white/72 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[#47392c]">Activity trail</p>
                        <span className="text-xs uppercase tracking-[0.18em] text-[#8a7a68]">
                          Local only
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {[...selectedEntry.history].reverse().slice(0, 5).map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-[rgba(19,17,13,0.08)] bg-white px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-[#17120d]">
                                {item.summary}
                              </span>
                              <span className="text-xs uppercase tracking-[0.18em] text-[#8a7a68]">
                                {formatRelative(item.changedAt)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-[#5f5044]">
                              Changed: {item.changedFields.join(", ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    aria-keyshortcuts="Control+S Meta+S"
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
                    onClick={() => void copyFieldToClipboard("username", draft.username)}
                    disabled={!draft.username}
                    className="flex items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-45"
                  >
                    <DocumentDuplicateIcon className="size-4" />
                    {copyUserLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyFieldToClipboard("password", draft.password)}
                    disabled={!draft.password}
                    className="flex items-center justify-center gap-2 rounded-full border border-[rgba(19,17,13,0.12)] px-4 py-3 text-sm font-semibold text-[#17120d] hover:bg-[rgba(19,17,13,0.04)] disabled:opacity-45"
                  >
                    <DocumentDuplicateIcon className="size-4" />
                    {copyPasswordLabel}
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
                {clipboardFeedback && clipboardMessage ? (
                  <div
                    aria-live="polite"
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-medium ${clipboardFeedbackStyles[clipboardFeedback.tone]}`}
                  >
                    {clipboardMessage}
                  </div>
                ) : null}
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
