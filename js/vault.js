/**
 * vault.js
 * ---------------------------------------------------------------------------
 * The site's only local-identity mechanism is the raw 32-byte SECRET_KEY
 * (shown once, as hex, right after an identity is created). This file never
 * writes it to localStorage/sessionStorage/cookies or any disk file — it
 * only ever exists in page memory and in whatever the visitor personally
 * copies down.
 * ---------------------------------------------------------------------------
 */

import { identityFromSeed, exportSeed, seedToHex, seedFromHex } from "./crypto.js";

/** Restore an identity directly from a 64-character hex SECRET_KEY. */
export async function unlockFromSecretKeyHex(hex) {
  return identityFromSeed(seedFromHex(hex));
}

/** Expose the raw SECRET_KEY (hex) for a live identity. */
export async function revealSecretKeyHex(identity) {
  const seed = await exportSeed(identity.privateKey);
  return seedToHex(seed);
}
