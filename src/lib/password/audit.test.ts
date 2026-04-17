import { describe, expect, it } from "vitest";
import type { VaultEntry } from "@/lib/types";
import {
  auditVault,
  filterVaultEntryAudits,
  sortVaultEntriesByRisk,
  type VaultEntryAudit,
} from "@/lib/password/audit";

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  const now = "2026-04-15T12:00:00.000Z";

  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Example",
    username: overrides.username ?? "user@example.com",
    password: overrides.password ?? "CorrectHorseBatteryStaple!42",
    website: overrides.website ?? "https://example.com",
    notes: overrides.notes ?? "",
    tags: overrides.tags ?? [],
    customFields: overrides.customFields ?? [],
    history: overrides.history ?? [],
    favorite: overrides.favorite ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function getSampleAudits(): VaultEntryAudit[] {
  const sharedPassword = "SharedVaultPassword!42";
  const weakPassword = "password123";

  return auditVault([
    makeEntry({ id: "1", title: "Alpha", favorite: true }),
    makeEntry({ id: "2", title: "Beta", password: weakPassword }),
    makeEntry({ id: "3", title: "Gamma", password: sharedPassword }),
    makeEntry({ id: "4", title: "Delta", password: sharedPassword }),
    makeEntry({ id: "5", title: "Epsilon", password: "aaa111aaa111" }),
    makeEntry({ id: "6", title: "Zeta", password: "aaa111aaa111" }),
  ]).entries;
}

describe("auditVault", () => {
  it("summarizes weak, reused and favorite entries", () => {
    const result = auditVault([
      makeEntry({ id: "1", title: "Alpha", favorite: true }),
      makeEntry({ id: "2", title: "Beta", password: "password123" }),
      makeEntry({ id: "3", title: "Gamma", password: "SharedVaultPassword!42" }),
      makeEntry({ id: "4", title: "Delta", password: "SharedVaultPassword!42" }),
    ]);

    expect(result.total).toBe(4);
    expect(result.favorites).toBe(1);
    expect(result.weakEntries).toBeGreaterThanOrEqual(1);
    expect(result.reusedPasswords).toBe(1);
    expect(result.entries).toHaveLength(4);
  });

  it("marks entry-level weak and reused warnings", () => {
    const result = auditVault([
      makeEntry({ id: "1", title: "Weak", password: "password123" }),
      makeEntry({ id: "2", title: "Reuse A", password: "SharedVaultPassword!42" }),
      makeEntry({ id: "3", title: "Reuse B", password: "SharedVaultPassword!42" }),
    ]);

    const weakEntry = result.entries.find((entry) => entry.entry.id === "1");
    const reusedEntry = result.entries.find((entry) => entry.entry.id === "2");

    expect(weakEntry?.flags).toContain("weak");
    expect(weakEntry?.warnings.join(" ")).toContain("length");
    expect(reusedEntry?.flags).toContain("reused");
    expect(reusedEntry?.warnings.join(" ")).toContain("reused across multiple entries");
  });

  it("orders higher-risk entries first", () => {
    const audits = getSampleAudits();

    expect(audits[0]?.entry.title).toBe("Epsilon");
    expect(audits[0]?.flags).toEqual(expect.arrayContaining(["weak", "reused"]));
    expect(audits[1]?.entry.title).toBe("Zeta");
    expect(audits[2]?.entry.title).toBe("Beta");
  });
});

describe("filterVaultEntryAudits", () => {
  it("filters by favorites, weak and reused flags", () => {
    const audits = getSampleAudits();

    const favorites = filterVaultEntryAudits(audits, { favoritesOnly: true });
    const weakOnly = filterVaultEntryAudits(audits, { weakOnly: true });
    const reusedOnly = filterVaultEntryAudits(audits, { reusedOnly: true });

    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.entry.title).toBe("Alpha");
    expect(weakOnly.every((entry) => entry.flags.includes("weak"))).toBe(true);
    expect(reusedOnly.every((entry) => entry.flags.includes("reused"))).toBe(true);
    expect(reusedOnly).toHaveLength(4);
  });

  it("applies filters together as an intersection", () => {
    const audits = getSampleAudits();

    const filtered = filterVaultEntryAudits(audits, {
      weakOnly: true,
      reusedOnly: true,
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.every((entry) => entry.flags.includes("weak") && entry.flags.includes("reused"))).toBe(true);
  });
});

describe("sortVaultEntriesByRisk", () => {
  it("keeps the highest risk entries at the top and uses stable tie-breakers", () => {
    const audits = getSampleAudits();
    const sorted = sortVaultEntriesByRisk([...audits].reverse());

    expect(sorted[0]?.entry.title).toBe("Epsilon");
    expect(sorted[1]?.entry.title).toBe("Zeta");
    expect(sorted.at(-1)?.entry.title).toBe("Alpha");
  });
});
