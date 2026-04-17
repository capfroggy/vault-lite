import { describe, expect, it } from "vitest";
import {
  createBackupBundle,
  createBackupFileName,
  mergeVaults,
  parseBackupBundle,
  summarizeImportedVault,
} from "@/lib/backup";
import { createEmptyVault, type EncryptedVaultRecord, type VaultEntry } from "@/lib/types";

describe("backup helpers", () => {
  const now = new Date("2026-04-17T12:00:00.000Z").toISOString();
  const record: EncryptedVaultRecord = {
    format: "vault-lite",
    version: 1,
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
  };

  function createEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
    return {
      id: crypto.randomUUID(),
      title: "GitHub",
      username: "brad@example.com",
      password: "Moss-Cascade-Frame-2719!",
      website: "https://github.com",
      notes: "",
      tags: ["work"],
      customFields: [],
      history: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it("creates and parses a current backup bundle", () => {
    const bundle = createBackupBundle(record);
    const parsed = parseBackupBundle(JSON.stringify(bundle));

    expect(parsed.app).toBe("vault-lite");
    expect(parsed.version).toBe(1);
    expect(parsed.vault.version).toBe(1);
    expect(parsed.vault.vaultId).toBe("primary");
  });

  it("parses a legacy backup bundle", () => {
    const parsed = parseBackupBundle(
      JSON.stringify({
        app: "vault-lite",
        version: 0,
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
      }),
    );

    expect(parsed.version).toBe(1);
    expect(parsed.vault.version).toBe(1);
  });

  it("throws on corrupt json", () => {
    expect(() => parseBackupBundle("{ definitely not json")).toThrow(SyntaxError);
  });

  it("creates deterministic backup filenames from a date", () => {
    expect(createBackupFileName(new Date("2026-04-17T12:00:00.000Z"))).toBe(
      "vault-lite-backup-2026-04-17T12-00-00-000Z.json",
    );
  });

  it("summarizes imported vault risk and metadata", () => {
    const bundle = createBackupBundle(record);
    const vault = createEmptyVault();
    vault.updatedAt = now;
    vault.entries = [
      createEntry({
        favorite: true,
        password: "password123",
        title: "GitHub",
      }),
      createEntry({
        password: "password123",
        title: "GitLab",
        username: "ops@example.com",
        website: "https://gitlab.com",
      }),
    ];

    const summary = summarizeImportedVault(bundle, vault);

    expect(summary.entryCount).toBe(2);
    expect(summary.favorites).toBe(1);
    expect(summary.weakEntries).toBe(2);
    expect(summary.reusedPasswordGroups).toBe(1);
    expect(summary.exportedAt).toBe(bundle.exportedAt);
  });

  it("merges imported entries by id and keeps the newest version", () => {
    const sharedId = crypto.randomUUID();
    const currentVault = createEmptyVault();
    currentVault.updatedAt = "2026-04-17T12:00:00.000Z";
    currentVault.entries = [
      createEntry({
        id: sharedId,
        title: "GitHub old",
        updatedAt: "2026-04-17T12:00:00.000Z",
      }),
      createEntry({
        title: "LinkedIn",
        username: "career@example.com",
        website: "https://linkedin.com",
      }),
    ];

    const importedVault = createEmptyVault();
    importedVault.updatedAt = "2026-04-17T14:00:00.000Z";
    importedVault.entries = [
      createEntry({
        id: sharedId,
        title: "GitHub refreshed",
        updatedAt: "2026-04-17T14:00:00.000Z",
      }),
      createEntry({
        title: "Trello",
        username: "pm@example.com",
        website: "https://trello.com",
      }),
    ];

    const mergePlan = mergeVaults(currentVault, importedVault);

    expect(mergePlan.added).toBe(1);
    expect(mergePlan.replaced).toBe(1);
    expect(mergePlan.unchanged).toBe(0);
    expect(mergePlan.resultingCount).toBe(3);
    expect(mergePlan.vault.entries.find((entry) => entry.id === sharedId)?.title).toBe(
      "GitHub refreshed",
    );
  });
});
