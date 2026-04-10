import { backupBundleSchema, type BackupBundle, type EncryptedVaultRecord } from "@/lib/types";

export function createBackupBundle(record: EncryptedVaultRecord): BackupBundle {
  return backupBundleSchema.parse({
    app: "vault-lite",
    version: 1,
    exportedAt: new Date().toISOString(),
    vault: record,
  });
}

export function parseBackupBundle(rawText: string) {
  return backupBundleSchema.parse(JSON.parse(rawText));
}

export function createBackupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `vault-lite-backup-${stamp}.json`;
}
