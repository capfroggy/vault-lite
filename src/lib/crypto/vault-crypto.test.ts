import { describe, expect, it } from "vitest";
import { createEncryptedVault, sealVault, unlockVault } from "@/lib/crypto/vault-crypto";
import { createEmptyVault } from "@/lib/types";

describe("vault crypto", () => {
  it("creates and unlocks an encrypted vault", async () => {
    const vault = createEmptyVault();
    vault.entries = [
      {
        id: crypto.randomUUID(),
        title: "GitHub",
        username: "brad@example.com",
        password: "Moss-Cascade-Frame-2719!",
        website: "https://github.com",
        notes: "",
        tags: ["work"],
        favorite: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const { record } = await createEncryptedVault("Forest-Starlight-Bridge-4401!", vault);
    const unlocked = await unlockVault("Forest-Starlight-Bridge-4401!", record);

    expect(record.cipher.algorithm).toBe("AES-GCM");
    expect(unlocked.vault.entries[0]?.title).toBe("GitHub");
  });

  it("rejects an invalid master password", async () => {
    const { record } = await createEncryptedVault("Forest-Starlight-Bridge-4401!");

    await expect(unlockVault("wrong-password", record)).rejects.toThrow(
      "Unable to unlock the vault",
    );
  });

  it("reseals the vault with a fresh iv", async () => {
    const { key, record, vault } = await createEncryptedVault(
      "Forest-Starlight-Bridge-4401!",
    );
    const updatedVault = {
      ...vault,
      entries: [
        {
          id: crypto.randomUUID(),
          title: "LinkedIn",
          username: "brad@example.com",
          password: "River-Garden-Pulse-1194!",
          website: "https://linkedin.com",
          notes: "",
          tags: ["career"],
          favorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const resealed = await sealVault(updatedVault, key, {
      createdAt: record.createdAt,
      kdf: record.kdf,
    });

    expect(resealed.cipher.iv).not.toBe(record.cipher.iv);
    const unlocked = await unlockVault("Forest-Starlight-Bridge-4401!", resealed);
    expect(unlocked.vault.entries[0]?.title).toBe("LinkedIn");
  });
});
