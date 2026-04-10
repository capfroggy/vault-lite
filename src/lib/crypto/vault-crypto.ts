import {
  createEmptyVault,
  encryptedVaultRecordSchema,
  vaultSchema,
  type EncryptedVaultRecord,
  type Vault,
} from "@/lib/types";
import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/base64";

const AES_KEY_LENGTH = 256;
const GCM_IV_LENGTH = 12;
const SALT_LENGTH = 16;
export const PBKDF2_ITERATIONS = 600_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type VaultMetadata = Pick<EncryptedVaultRecord, "createdAt" | "kdf">;

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this environment.");
  }

  return globalThis.crypto;
}

function getRandomBytes(length: number) {
  const values = new Uint8Array(length);
  getWebCrypto().getRandomValues(values);
  return values;
}

async function deriveAesKey(
  password: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPayload(payload: string, key: CryptoKey) {
  const cryptoApi = getWebCrypto();
  const iv = getRandomBytes(GCM_IV_LENGTH);
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    textEncoder.encode(payload),
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptPayload(record: EncryptedVaultRecord, key: CryptoKey) {
  const cryptoApi = getWebCrypto();
  const decrypted = await cryptoApi.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(record.cipher.iv),
    },
    key,
    base64ToBytes(record.ciphertext),
  );

  return textDecoder.decode(decrypted);
}

export async function createEncryptedVault(
  password: string,
  initialVault: Vault = createEmptyVault(),
) {
  const salt = bytesToBase64(getRandomBytes(SALT_LENGTH));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const record = await sealVault(initialVault, key, {
    createdAt: initialVault.createdAt,
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
  });

  return {
    key,
    record,
    vault: initialVault,
  };
}

export async function unlockVault(password: string, record: EncryptedVaultRecord) {
  const key = await deriveAesKey(password, record.kdf.salt, record.kdf.iterations);

  try {
    const payload = await decryptPayload(record, key);
    return {
      key,
      vault: vaultSchema.parse(JSON.parse(payload)),
    };
  } catch {
    throw new Error("Unable to unlock the vault. Check the master password.");
  }
}

export async function sealVault(
  vault: Vault,
  key: CryptoKey,
  metadata: VaultMetadata,
): Promise<EncryptedVaultRecord> {
  const normalizedVault = vaultSchema.parse(vault);
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    ...normalizedVault,
    updatedAt: now,
  });
  const encrypted = await encryptPayload(payload, key);

  return encryptedVaultRecordSchema.parse({
    format: "vault-lite",
    version: 1,
    vaultId: "primary",
    createdAt: metadata.createdAt,
    updatedAt: now,
    kdf: metadata.kdf,
    cipher: {
      algorithm: "AES-GCM",
      iv: encrypted.iv,
    },
    ciphertext: encrypted.ciphertext,
  });
}
