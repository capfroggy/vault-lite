import type { VaultEntry } from "@/lib/types";
import { assessPasswordStrength } from "@/lib/password/strength";

export type VaultAuditFlag = "weak" | "reused";

export type VaultAuditFilters = {
  favoritesOnly?: boolean;
  weakOnly?: boolean;
  reusedOnly?: boolean;
};

export type VaultEntryAudit = {
  entry: VaultEntry;
  strength: ReturnType<typeof assessPasswordStrength>;
  flags: VaultAuditFlag[];
  duplicateCount: number;
  riskScore: number;
  warnings: string[];
};

export type VaultAuditSummary = {
  total: number;
  favorites: number;
  weakEntries: number;
  reusedPasswords: number;
};

export type VaultAuditResult = VaultAuditSummary & {
  entries: VaultEntryAudit[];
};

function buildPasswordCounts(entries: VaultEntry[]) {
  const passwordCounts = new Map<string, number>();

  for (const entry of entries) {
    passwordCounts.set(entry.password, (passwordCounts.get(entry.password) ?? 0) + 1);
  }

  return passwordCounts;
}

function buildEntryAudit(entry: VaultEntry, duplicateCount: number): VaultEntryAudit {
  const strength = assessPasswordStrength(entry.password);
  const flags: VaultAuditFlag[] = [];

  if (strength.score < 3) {
    flags.push("weak");
  }

  if (duplicateCount > 1) {
    flags.push("reused");
  }

  const warnings = [
    ...(flags.includes("weak") ? [strength.feedback[0] ?? "This password is too weak."] : []),
    ...(flags.includes("reused") ? ["This password is reused across multiple entries."] : []),
  ];

  const riskScore =
    (flags.includes("reused") ? 6 : 0) +
    (flags.includes("weak") ? 4 + (3 - strength.score) : 0) +
    Math.max(0, 2 - strength.score);

  return {
    entry,
    strength,
    flags,
    duplicateCount,
    riskScore,
    warnings,
  };
}

export function auditVault(entries: VaultEntry[]): VaultAuditResult {
  const passwordCounts = buildPasswordCounts(entries);
  const entryAudits = entries.map((entry) => buildEntryAudit(entry, passwordCounts.get(entry.password) ?? 0));

  const weakEntries = entryAudits.filter((entry) => entry.flags.includes("weak")).length;
  const reusedPasswords = [...passwordCounts.values()].filter((count) => count > 1).length;
  const favorites = entries.filter((entry) => entry.favorite).length;

  return {
    total: entries.length,
    favorites,
    weakEntries,
    reusedPasswords,
    entries: sortVaultEntriesByRisk(entryAudits),
  };
}

export function filterVaultEntryAudits(entries: VaultEntryAudit[], filters: VaultAuditFilters = {}) {
  return entries.filter((entry) => {
    if (filters.favoritesOnly && !entry.entry.favorite) {
      return false;
    }

    if (filters.weakOnly && !entry.flags.includes("weak")) {
      return false;
    }

    if (filters.reusedOnly && !entry.flags.includes("reused")) {
      return false;
    }

    return true;
  });
}

export function sortVaultEntriesByRisk(entries: VaultEntryAudit[]) {
  return [...entries].sort((left, right) => {
    if (right.riskScore !== left.riskScore) {
      return right.riskScore - left.riskScore;
    }

    if (right.duplicateCount !== left.duplicateCount) {
      return right.duplicateCount - left.duplicateCount;
    }

    if (left.entry.favorite !== right.entry.favorite) {
      return Number(right.entry.favorite) - Number(left.entry.favorite);
    }

    return left.entry.title.localeCompare(right.entry.title);
  });
}

export function getVaultEntryAudits(entries: VaultEntry[]) {
  return auditVault(entries).entries;
}
