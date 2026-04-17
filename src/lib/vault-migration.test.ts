import { describe, expect, it } from "vitest";
import {
  normalizeBackupBundle,
  normalizeEncryptedVaultRecord,
  migrateVaultSnapshot,
} from "@/lib/vault-migration";

describe("vault migration", () => {
  const now = new Date("2026-04-15T12:00:00.000Z").toISOString();
  const entry = {
    id: crypto.randomUUID(),
    title: "GitHub",
    username: "brad@example.com",
    password: "Moss-Cascade-Frame-2719!",
    website: "https://github.com",
    notes: "",
    tags: ["work"],
    favorite: true,
    createdAt: now,
    updatedAt: now,
  };

  it("upgrades a legacy vault snapshot without a version field", () => {
    const migrated = migrateVaultSnapshot({
      createdAt: now,
      updatedAt: now,
      entries: [entry],
    });

    expect(migrated.version).toBe(2);
    expect(migrated.entries).toHaveLength(1);
    expect(migrated.entries[0]?.title).toBe("GitHub");
    expect(migrated.entries[0]?.customFields).toEqual([]);
    expect(migrated.entries[0]?.history).toHaveLength(1);
  });

  it("preserves custom fields and history in a current vault snapshot", () => {
    const customFieldId = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const currentSnapshot = {
      version: 2,
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          ...entry,
          customFields: [
            {
              id: customFieldId,
              label: "Recovery code",
              value: "alpha-bravo-charlie",
            },
          ],
          history: [
            {
              id: historyId,
              changedAt: now,
              action: "updated",
              changedFields: ["password", "notes"],
              summary: "Refreshed password and note.",
            },
          ],
        },
      ],
    };

    expect(migrateVaultSnapshot(currentSnapshot)).toEqual(currentSnapshot);
  });

  it("normalizes a legacy encrypted vault record", () => {
    const normalized = normalizeEncryptedVaultRecord({
      format: "vault-lite",
      createdAt: now,
      updatedAt: now,
      vaultId: "primary",
      kdf: {
        algorithm: "PBKDF2",
        hash: "SHA-256",
        iterations: 600_000,
        salt: "salty-salt-value",
      },
      cipher: {
        algorithm: "AES-GCM",
        iv: "iv-value-1234567",
      },
      ciphertext: "ciphertext-value-1234",
    });

    expect(normalized.version).toBe(1);
    expect(normalized.cipher.algorithm).toBe("AES-GCM");
  });

  it("normalizes a legacy backup bundle and nested record", () => {
    const bundle = normalizeBackupBundle({
      app: "vault-lite",
      exportedAt: now,
      vault: {
        format: "vault-lite",
        createdAt: now,
        updatedAt: now,
        vaultId: "primary",
        kdf: {
          algorithm: "PBKDF2",
          hash: "SHA-256",
          iterations: 600_000,
          salt: "salty-salt-value",
        },
        cipher: {
          algorithm: "AES-GCM",
          iv: "iv-value-1234567",
        },
        ciphertext: "ciphertext-value-1234",
      },
    });

    expect(bundle.version).toBe(1);
    expect(bundle.vault.version).toBe(1);
    expect(bundle.vault.vaultId).toBe("primary");
  });

  it("rejects an incomplete legacy backup bundle", () => {
    expect(() =>
      normalizeBackupBundle({
        app: "vault-lite",
        exportedAt: now,
        vault: {
          format: "vault-lite",
          createdAt: now,
          updatedAt: now,
          vaultId: "primary",
          kdf: {
            algorithm: "PBKDF2",
            hash: "SHA-256",
            iterations: 600_000,
            salt: "salty-salt-value",
          },
          cipher: {
            algorithm: "AES-GCM",
            iv: "iv-value-1234567",
          },
        },
      }),
    ).toThrow("Unsupported backup bundle format.");
  });
});
