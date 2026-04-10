import { z } from "zod";

export const entrySchema = z.object({
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

export const vaultSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  entries: z.array(entrySchema),
});

export const encryptedVaultRecordSchema = z.object({
  format: z.literal("vault-lite"),
  version: z.literal(1),
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
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  vault: encryptedVaultRecordSchema,
});

export const settingsSchema = z.object({
  autoLockMinutes: z.number().int().min(1).max(60),
});

export type VaultEntry = z.infer<typeof entrySchema>;
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
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
}
