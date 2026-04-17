# VaultLite

VaultLite is a local-first password manager demo built with `Next.js`, `TypeScript`, `Web Crypto`, and `IndexedDB`.

It is intentionally scoped as an educational security project:
- the master password is never stored
- vault data is encrypted before persistence
- backups are exported as encrypted JSON bundles
- decrypted state lives in memory only while the session is unlocked

This is **not** a production password manager. It is a portfolio-ready demo focused on applied frontend security decisions and clear engineering tradeoffs.

## Why this repo is useful

This project is designed to be worth discussing in GitHub reviews, interviews, and LinkedIn posts:
- local vault creation and unlock flow
- PBKDF2-based key derivation with per-vault salt
- AES-GCM encryption for the stored vault blob
- encrypted backup export, restore preview, and unlocked import with merge-or-replace flows
- inactivity-based auto-lock
- password generator, clipboard auto-clear, and actionable vault hygiene signals
- risk filters, entry audit trail, custom fields, and schema migration support
- unit tests plus CI for crypto, migration, and password utilities

## Stack

- `Next.js 16`
- `React 19`
- `TypeScript`
- `Tailwind CSS 4`
- `Web Crypto API`
- `IndexedDB` via `idb`
- `Vitest`

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run lint
npm run test
npm run build
```

## Security notes

- Vault records are stored locally in `IndexedDB`.
- The app stores encrypted payloads, not plaintext credentials.
- The session key is derived from the master password and kept in memory only for the active session.
- Exported backups remain encrypted and still require the master password to restore.
- This demo does not include sync, account recovery, team sharing, or emergency access.

For the fuller security framing, see [docs/security-model.md](./docs/security-model.md).

## Project structure

```text
src/
  app/
  components/vault/
  lib/
    crypto/
    password/
    storage/
docs/
  security-model.md
  roadmap.md
```

## Next improvements

- per-entry attachments with explicit size and safety limits
- broader accessibility pass for focus flow and screen readers
- optional WebAuthn-assisted unlock experiments
- deeper persistence and recovery tests around lock timing and interrupted restore flows

For planned milestones, see [docs/roadmap.md](./docs/roadmap.md).
