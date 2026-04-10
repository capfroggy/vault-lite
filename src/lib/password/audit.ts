import type { VaultEntry } from "@/lib/types";
import { assessPasswordStrength } from "@/lib/password/strength";

export function auditVault(entries: VaultEntry[]) {
  const passwordCounts = new Map<string, number>();

  for (const entry of entries) {
    passwordCounts.set(entry.password, (passwordCounts.get(entry.password) ?? 0) + 1);
  }

  const reusedPasswords = [...passwordCounts.values()].filter((count) => count > 1).length;
  const weakEntries = entries.filter((entry) => assessPasswordStrength(entry.password).score < 3).length;
  const favorites = entries.filter((entry) => entry.favorite).length;

  return {
    total: entries.length,
    favorites,
    weakEntries,
    reusedPasswords,
  };
}
