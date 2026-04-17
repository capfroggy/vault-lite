import { auditVault } from "@/lib/password/audit";
import {
  backupBundleSchema,
  type BackupBundle,
  type EncryptedVaultRecord,
  type Vault,
} from "@/lib/types";
import { normalizeBackupBundle, normalizeEncryptedVaultRecord } from "@/lib/vault-migration";

export type ImportedVaultSummary = {
  entryCount: number;
  exportedAt: string;
  favorites: number;
  reusedPasswordGroups: number;
  updatedAt: string;
  weakEntries: number;
};

export type VaultMergePlan = {
  added: number;
  replaced: number;
  resultingCount: number;
  unchanged: number;
  vault: Vault;
};

export function createBackupBundle(record: EncryptedVaultRecord): BackupBundle {
  return backupBundleSchema.parse({
    app: "vault-lite",
    version: 1,
    exportedAt: new Date().toISOString(),
    vault: normalizeEncryptedVaultRecord(record),
  });
}

export function parseBackupBundle(rawText: string) {
  return normalizeBackupBundle(JSON.parse(rawText));
}

export function summarizeImportedVault(bundle: BackupBundle, vault: Vault): ImportedVaultSummary {
  const audit = auditVault(vault.entries);

  return {
    entryCount: vault.entries.length,
    exportedAt: bundle.exportedAt,
    favorites: audit.favorites,
    reusedPasswordGroups: audit.reusedPasswords,
    updatedAt: vault.updatedAt,
    weakEntries: audit.weakEntries,
  };
}

function sortEntriesByUpdatedAt(entries: Vault["entries"]) {
  return [...entries].sort((left, right) => {
    const rightTime = new Date(right.updatedAt).getTime();
    const leftTime = new Date(left.updatedAt).getTime();

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return left.title.localeCompare(right.title);
  });
}

export function mergeVaults(currentVault: Vault, importedVault: Vault): VaultMergePlan {
  const mergedEntries = new Map(currentVault.entries.map((entry) => [entry.id, entry]));
  let added = 0;
  let replaced = 0;
  let unchanged = 0;

  for (const importedEntry of importedVault.entries) {
    const existingEntry = mergedEntries.get(importedEntry.id);

    if (!existingEntry) {
      mergedEntries.set(importedEntry.id, importedEntry);
      added += 1;
      continue;
    }

    if (new Date(importedEntry.updatedAt).getTime() > new Date(existingEntry.updatedAt).getTime()) {
      mergedEntries.set(importedEntry.id, importedEntry);
      replaced += 1;
      continue;
    }

    unchanged += 1;
  }

  return {
    added,
    replaced,
    resultingCount: mergedEntries.size,
    unchanged,
    vault: {
      ...currentVault,
      updatedAt: added > 0 || replaced > 0 ? importedVault.updatedAt : currentVault.updatedAt,
      entries: sortEntriesByUpdatedAt([...mergedEntries.values()]),
    },
  };
}

export function getBackupErrorMessage(error: unknown) {
  if (error instanceof SyntaxError) {
    return "Backup file is not valid JSON.";
  }

  if (error instanceof Error) {
    if (error.message === "Unsupported backup bundle format.") {
      return "Backup file is not a supported VaultLite encrypted backup.";
    }

    if (error.message === "Unsupported encrypted vault record format.") {
      return "Backup contains an encrypted vault format this app does not understand.";
    }

    if (error.message === "Unable to unlock the vault. Check the master password.") {
      return "That master password did not unlock the selected backup.";
    }

    return error.message;
  }

  return "Unexpected backup error.";
}

export function createBackupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vault-lite-backup-${stamp}.json`;
}
