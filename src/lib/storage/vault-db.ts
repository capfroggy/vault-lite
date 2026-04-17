import { openDB, type DBSchema } from "idb";
import {
  DEFAULT_SETTINGS,
  settingsSchema,
  type EncryptedVaultRecord,
  type VaultSettings,
} from "@/lib/types";
import { normalizeEncryptedVaultRecord } from "@/lib/vault-migration";

interface VaultLiteSchema extends DBSchema {
  vaults: {
    key: string;
    value: EncryptedVaultRecord;
  };
  settings: {
    key: string;
    value: VaultSettings;
  };
}

const DB_NAME = "vault-lite";
const DB_VERSION = 1;
const PRIMARY_VAULT_KEY = "primary";
const SETTINGS_KEY = "preferences";

function getDatabase() {
  return openDB<VaultLiteSchema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("vaults")) {
        database.createObjectStore("vaults");
      }

      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings");
      }
    },
  });
}

export async function getEncryptedVault() {
  const database = await getDatabase();
  const value = await database.get("vaults", PRIMARY_VAULT_KEY);
  if (!value) {
    return null;
  }

  const normalized = normalizeEncryptedVaultRecord(value);
  if (value.version !== normalized.version) {
    await database.put("vaults", normalized, PRIMARY_VAULT_KEY);
  }

  return normalized;
}

export async function saveEncryptedVault(record: EncryptedVaultRecord) {
  const database = await getDatabase();
  await database.put("vaults", normalizeEncryptedVaultRecord(record), PRIMARY_VAULT_KEY);
}

export async function getVaultSettings() {
  const database = await getDatabase();
  const value = await database.get("settings", SETTINGS_KEY);
  return value ? settingsSchema.parse(value) : DEFAULT_SETTINGS;
}

export async function saveVaultSettings(settings: VaultSettings) {
  const database = await getDatabase();
  await database.put("settings", settingsSchema.parse(settings), SETTINGS_KEY);
}
