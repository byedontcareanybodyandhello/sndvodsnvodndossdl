/**
 * vault.js
 * ---------------------------------------------------------------------------
 * Local, encrypted identity backup. This is the web equivalent of the CLI's
 * encrypted identity.pem — a passphrase-protected file the user downloads
 * and is responsible for keeping. This site never uploads it anywhere and
 * never stores it in localStorage/sessionStorage/cookies: it lives only in
 * page memory for the current tab, and on the user's own disk as a download.
 * ---------------------------------------------------------------------------
 */

import { identityFromSeed, exportSeed, seedToHex, seedFromHex } from "./crypto.js";

export class VaultError extends Error {}

const BACKUP_SCHEMA = "flop-dossier-vault-backup-v1";
const PBKDF2_ITERATIONS = 300_000;
const MIN_PASSPHRASE_LENGTH = 12;

function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError(`passphrase must contain at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
}

function bufToB64(buf) {
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveAesKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt an identity's raw seed under a passphrase. Returns a plain object
 * ready to be JSON-serialized and offered as a file download.
 */
export async function createEncryptedBackup(identity, passphrase) {
  assertPassphrase(passphrase);
  const seed = await exportSeed(identity.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, seed);
  return {
    schema: BACKUP_SCHEMA,
    did: identity.did,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ciphertext: bufToB64(ciphertext),
    created_at: new Date().toISOString(),
  };
}

/**
 * Decrypt a backup object (as parsed from the downloaded JSON) with its
 * passphrase and restore the full identity. Throws VaultError on any
 * mismatch, including a corrupted file or wrong passphrase.
 */
export async function unlockEncryptedBackup(backup, passphrase) {
  assertPassphrase(passphrase);
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new VaultError("this file is not a recognized vault backup");
  }
  const salt = b64ToBuf(backup.salt);
  const iv = b64ToBuf(backup.iv);
  const ciphertext = b64ToBuf(backup.ciphertext);
  const key = await deriveAesKey(passphrase, salt);
  let seedBuf;
  try {
    seedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new VaultError("incorrect passphrase or corrupted backup file");
  }
  const identity = await identityFromSeed(new Uint8Array(seedBuf));
  if (backup.did && identity.did !== backup.did) {
    throw new VaultError("decrypted identity does not match the DID recorded in this backup");
  }
  return identity;
}

/** Restore an identity directly from a 64-character hex SECRET_KEY. */
export async function unlockFromSecretKeyHex(hex) {
  return identityFromSeed(seedFromHex(hex));
}

/** Expose the raw SECRET_KEY (hex) for a live identity — shown once, on request only. */
export async function revealSecretKeyHex(identity) {
  const seed = await exportSeed(identity.privateKey);
  return seedToHex(seed);
}

/** Trigger a browser download of a JSON-serializable object. */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
