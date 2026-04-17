import { z } from "zod";

export const VAULT_SCHEMA_VERSION = 2;
export const ENCRYPTED_VAULT_RECORD_VERSION = 1;
export const BACKUP_BUNDLE_VERSION = 1;

export const customFieldSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(400),
});

export const entryHistoryItemSchema = z.object({
  id: z.string().uuid(),
  changedAt: z.string().datetime(),
  action: z.enum(["created", "updated"]),
  changedFields: z.array(z.string().trim().min(1).max(40)).max(12),
  summary: z.string().trim().min(1).max(240),
});

export const entrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  username: z.string().trim().min(1).max(160),
  password: z.string().min(1).max(4096),
  website: z.string().trim().max(2048),
  notes: z.string().max(4000),
  tags: z.array(z.string().trim().min(1).max(24)).max(8),
  customFields: z.array(customFieldSchema).max(6),
  history: z.array(entryHistoryItemSchema).max(20),
  favorite: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const vaultSchema = z.object({
  version: z.literal(VAULT_SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  entries: z.array(entrySchema),
});

export const encryptedVaultRecordSchema = z.object({
  format: z.literal("vault-lite"),
  version: z.literal(ENCRYPTED_VAULT_RECORD_VERSION),
  vaultId: z.literal("primary"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  kdf: z.object({
    algorithm: z.literal("PBKDF2"),
    hash: z.literal("SHA-256"),
    iterations: z.number().int().min(100_000).max(2_000_000),
    salt: z.string().min(16),
  }),
  cipher: z.object({
    algorithm: z.literal("AES-GCM"),
    iv: z.string().min(16),
  }),
  ciphertext: z.string().min(16),
});

export const backupBundleSchema = z.object({
  app: z.literal("vault-lite"),
  version: z.literal(BACKUP_BUNDLE_VERSION),
  exportedAt: z.string().datetime(),
  vault: encryptedVaultRecordSchema,
});

export const settingsSchema = z.object({
  autoLockMinutes: z.number().int().min(1).max(60),
});

export type VaultEntry = z.infer<typeof entrySchema>;
export type VaultCustomField = z.infer<typeof customFieldSchema>;
export type VaultEntryHistoryItem = z.infer<typeof entryHistoryItemSchema>;
export type Vault = z.infer<typeof vaultSchema>;
export type EncryptedVaultRecord = z.infer<typeof encryptedVaultRecordSchema>;
export type BackupBundle = z.infer<typeof backupBundleSchema>;
export type VaultSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
};

export function createEmptyVault(): Vault {
  const now = new Date().toISOString();

  return {
    version: VAULT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
}
