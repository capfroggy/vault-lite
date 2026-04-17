import { z } from "zod";
import {
  BACKUP_BUNDLE_VERSION,
  ENCRYPTED_VAULT_RECORD_VERSION,
  VAULT_SCHEMA_VERSION,
  backupBundleSchema,
  customFieldSchema,
  encryptedVaultRecordSchema,
  entryHistoryItemSchema,
  type BackupBundle,
  type EncryptedVaultRecord,
  type VaultEntry,
  type Vault,
  vaultSchema,
} from "@/lib/types";

const legacyEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  username: z.string().trim().min(1).max(160),
  password: z.string().min(1).max(4096),
  website: z.string().trim().max(2048),
  notes: z.string().max(4000),
  tags: z.array(z.string().trim().min(1).max(24)).max(8),
  favorite: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const legacyVaultSchema = z.object({
  version: z.union([z.literal(0), z.literal(1)]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  entries: z.array(legacyEntrySchema),
});

const legacyEncryptedVaultRecordSchema = z.object({
  format: z.literal("vault-lite"),
  version: z.literal(0).optional(),
  vaultId: z.literal("primary"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  kdf: encryptedVaultRecordSchema.shape.kdf,
  cipher: encryptedVaultRecordSchema.shape.cipher,
  ciphertext: z.string().min(16),
});

const legacyBackupBundleSchema = z.object({
  app: z.literal("vault-lite"),
  version: z.literal(0).optional(),
  exportedAt: z.string().datetime(),
  vault: legacyEncryptedVaultRecordSchema,
});

function migrateEntry(input: z.infer<typeof legacyEntrySchema>): VaultEntry {
  return {
    ...input,
    customFields: customFieldSchema.array().parse([]),
    history: entryHistoryItemSchema.array().parse([
      {
        id: crypto.randomUUID(),
        changedAt: input.updatedAt,
        action: "created",
        changedFields: ["title", "username", "password"],
        summary: `Migrated legacy entry for ${input.title}.`,
      },
    ]),
  };
}

export function migrateVaultSnapshot(input: unknown): Vault {
  const current = vaultSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const legacy = legacyVaultSchema.safeParse(input);
  if (!legacy.success) {
    throw new Error("Unsupported vault snapshot format.");
  }

  return {
    ...legacy.data,
    version: VAULT_SCHEMA_VERSION,
    entries: legacy.data.entries.map(migrateEntry),
  };
}

export function normalizeEncryptedVaultRecord(
  input: unknown,
): EncryptedVaultRecord {
  const current = encryptedVaultRecordSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const legacy = legacyEncryptedVaultRecordSchema.safeParse(input);
  if (!legacy.success) {
    throw new Error("Unsupported encrypted vault record format.");
  }

  return {
    ...legacy.data,
    version: ENCRYPTED_VAULT_RECORD_VERSION,
  };
}

export function normalizeBackupBundle(input: unknown): BackupBundle {
  const current = backupBundleSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const legacy = legacyBackupBundleSchema.safeParse(input);
  if (!legacy.success) {
    throw new Error("Unsupported backup bundle format.");
  }

  return {
    app: legacy.data.app,
    version: BACKUP_BUNDLE_VERSION,
    exportedAt: legacy.data.exportedAt,
    vault: normalizeEncryptedVaultRecord(legacy.data.vault),
  };
}
