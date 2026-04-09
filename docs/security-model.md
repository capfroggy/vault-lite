# Security Model

## Purpose
This project is an educational, local-first password manager demo. Its goal is to show how a modern frontend can protect sensitive data with client-side cryptography, careful storage design, and a small, auditable surface area.

This is not production software. It is intentionally scoped to be understandable, demonstrable, and useful for a portfolio or GitHub showcase.

## Goals
- Protect vault data at rest in the browser using client-side encryption.
- Keep the master password out of persistent storage.
- Minimize the amount of plaintext that exists in memory and on disk.
- Make cryptographic decisions explicit and easy to review.
- Support a safe export and import flow for encrypted backups.
- Provide a professional demo that demonstrates engineering judgment, not just UI work.

## Non-Goals
- Multi-device sync.
- Team sharing or shared vaults.
- Cloud backup or server-side recovery.
- Recovery without the master password.
- Anti-malware protection on the user's device.
- Full replacement for commercial password managers.

## Assumptions
- The app is built with Next.js, TypeScript, Web Crypto API, and IndexedDB.
- Vault data stays local unless the user explicitly exports an encrypted backup.
- The browser environment is trusted enough to run the app, but not assumed to be perfectly secure.
- The demo is intended for desktop browsers first.
- Strong cryptographic primitives are available in the browser, but third-party libraries should still be reviewed carefully.

## High-Level Architecture
- `UI layer`: handles login, vault management, password generation, and settings.
- `Crypto layer`: derives keys from the master password and encrypts or decrypts vault data.
- `Storage layer`: stores only encrypted vault blobs and non-sensitive metadata in IndexedDB.
- `Export layer`: creates encrypted backup files for offline download.
- `Session layer`: keeps decrypted state only for the active session and clears it on lock or timeout.

## Data Flow
1. The user creates or enters a master password.
2. The app derives a key from the master password using a slow password-based key derivation function.
3. The vault is decrypted only in memory after successful verification.
4. New entries are encrypted before being written back to IndexedDB.
5. Exported backups are encrypted before leaving the browser.
6. The vault is locked after inactivity or manual lock.

## Threats
- Local device compromise or browser profile theft.
- Weak master passwords.
- Cross-site scripting or injected frontend code.
- Exposure through developer tools, logs, or accidental plaintext persistence.
- Insecure dependency choices in the crypto or UI stack.
- Replay or tampering attempts against local storage blobs.

## Mitigations
- Use a slow password derivation strategy with a unique salt.
- Encrypt vault contents with authenticated encryption.
- Store only encrypted payloads in IndexedDB.
- Avoid console logging secrets, decrypted vaults, or derived keys.
- Keep decrypted data in memory only while the vault is unlocked.
- Clear sensitive in-memory state on lock, logout, tab close, and inactivity timeout.
- Validate all user input before it reaches the crypto or storage layers.
- Keep the dependency footprint small and review any package used in security-sensitive paths.

## Cryptographic Notes
- Master password should never be stored directly.
- Each vault should use a unique salt.
- Each encryption operation should use a fresh IV or nonce.
- Authenticated encryption is required so tampering can be detected.
- The export format should include versioning so future migrations are possible.
- The app should be explicit about which choices are educational defaults and which are production-grade requirements.

## Limitations
- If the browser, device, or operating system is compromised, client-side encryption alone cannot guarantee safety.
- Memory-resident secrets may still be observable by advanced local attackers.
- Browser storage and extension ecosystems are not equivalent to a hardened native application.
- The demo does not provide enterprise recovery, rotation policy enforcement, or administrative control.
- This project should be presented as a secure engineering exercise, not as a finished password manager.

