/**
 * vault.js
 * The only local-identity mechanism is the raw 32-byte SECRET_KEY (shown
 * once, as hex, right after an identity is created). It is never written
 * to localStorage, sessionStorage, cookies, or disk — it only exists in
 * page memory and in whatever the visitor personally copies down.
 */

import { identityFromSeed, exportSeed, seedToHex, seedFromHex } from "./crypto.js";

/** Restores an identity directly from a 64-character hex SECRET_KEY. */
export async function unlockFromSecretKeyHex(hex) {
  return identityFromSeed(seedFromHex(hex));
}

/** Exposes the raw SECRET_KEY (hex) for a live identity. */
export async function revealSecretKeyHex(identity) {
  const seed = await exportSeed(identity.privateKey);
  return seedToHex(seed);
}
