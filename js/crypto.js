/**
 * crypto.js
 * ---------------------------------------------------------------------------
 * Browser-native port of the protocol logic in zunmax/technocore-did-starter
 * (technocore_agent.py). Every function here mirrors a specific function in
 * the Python CLI so the two stay bit-for-bit compatible on the wire.
 *
 * No external crypto library is used. Ed25519 keygen/sign/verify comes from
 * the native Web Crypto API (crypto.subtle). Private key material never
 * leaves this module except as an encrypted backup blob (see vault.js).
 * ---------------------------------------------------------------------------
 */

export class ProtocolError extends Error {}
export class IdentityError extends Error {}

const MULTICODEC_ED25519 = new Uint8Array([0xed, 0x01]); // matches MULTICODEC_ED25519 in the CLI
const MULTIBASE_LENGTH = 48; // matches MULTIBASE_LENGTH
const SIGNATURE_LENGTH = 86; // matches SIGNATURE_LENGTH
const MAX_MESSAGE_CHARS = 4096; // matches MAX_MESSAGE_CHARS

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/; // matches NAME_PATTERN
const NONCE_RE = /^[0-9]{1,19}$/; // matches NONCE_PATTERN
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/; // matches SIGNATURE_PATTERN
const COMMIT_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/; // matches COMMIT_PATTERN

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_INDEX = Object.fromEntries([...B58_ALPHABET].map((c, i) => [c, i]));

/* ---------------------------------------------------------------- base58btc */

export function base58btcEncode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  let encoded = "";
  while (num > 0n) {
    const rem = num % 58n;
    num /= 58n;
    encoded = B58_ALPHABET[Number(rem)] + encoded;
  }
  return "1".repeat(zeros) + encoded;
}

export function base58btcDecode(value) {
  let num = 0n;
  for (const ch of value) {
    const digit = B58_INDEX[ch];
    if (digit === undefined) {
      throw new ProtocolError(`invalid base58btc character: ${JSON.stringify(ch)}`);
    }
    num = num * 58n + BigInt(digit);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const decoded = hex === "00" ? new Uint8Array() : hexToBytes(hex);
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;
  const out = new Uint8Array(zeros + decoded.length);
  out.set(decoded, zeros);
  return out;
}

/* ----------------------------------------------------------- byte utilities */

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function concatBytes(...chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function b64urlEncode(bytes) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------- did:key derivation */

/** Mirrors did_from_private_key(): raw 32-byte public key -> did:key:z6Mk... */
export function didFromPublicKeyBytes(publicKeyRaw) {
  if (publicKeyRaw.length !== 32) {
    throw new IdentityError("public key must be 32 raw bytes");
  }
  const multibase = "z" + base58btcEncode(concatBytes(MULTICODEC_ED25519, publicKeyRaw));
  if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
    throw new IdentityError("generated an invalid Ed25519 did:key");
  }
  return "did:key:" + multibase;
}

/** Mirrors public_key_from_did(): did:key:z6Mk... -> raw 32-byte public key */
export function publicKeyBytesFromDid(did) {
  const prefix = "did:key:";
  if (typeof did !== "string" || !did.startsWith(prefix)) {
    throw new ProtocolError("DID must start with 'did:key:z6Mk'");
  }
  const multibase = did.slice(prefix.length);
  if (multibase.length !== MULTIBASE_LENGTH || !multibase.startsWith("z6Mk")) {
    throw new ProtocolError("DID must be the canonical 48-character Ed25519 multibase form");
  }
  const decoded = base58btcDecode(multibase.slice(1));
  if (decoded.length !== 34 || decoded[0] !== MULTICODEC_ED25519[0] || decoded[1] !== MULTICODEC_ED25519[1]) {
    throw new ProtocolError("DID must contain an ed25519-pub key");
  }
  return decoded.slice(2);
}

/* ------------------------------------------------------ key pair lifecycle */

/** Generate a brand-new Ed25519 identity. Returns {privateKey, publicKeyRaw, did}. */
export async function generateIdentity() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const did = didFromPublicKeyBytes(publicKeyRaw);
  return { privateKey: pair.privateKey, publicKeyRaw, did };
}

/**
 * Rebuild a minimal RFC 8410 PKCS#8 document containing only the 32-byte
 * Ed25519 seed (no embedded public key). This is the same document shape
 * defined in RFC 8410 Appendix A; a spec-following WebCrypto implementation
 * derives the matching public key internally when this is imported.
 */
export function seedToPkcs8(seed32) {
  if (seed32.length !== 32) throw new IdentityError("seed must be 32 bytes");
  // 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 <32-byte seed>
  const header = hexToBytes("302e020100300506032b657004220420");
  return concatBytes(header, seed32);
}

/** Restore an identity from its raw 32-byte seed (the site's "SECRET_KEY"). */
export async function identityFromSeed(seed32) {
  const pkcs8 = seedToPkcs8(seed32);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
  // JWK export always carries the derived public component ("x") for OKP keys,
  // regardless of how the private key was imported.
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKeyRaw = b64urlDecode(jwk.x);
  const did = didFromPublicKeyBytes(publicKeyRaw);
  return { privateKey, publicKeyRaw, did };
}

/** Export the raw 32-byte seed from a live private key (session-only; never persisted unencrypted). */
export async function exportSeed(privateKey) {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  return b64urlDecode(jwk.d);
}

export function seedToHex(seed32) {
  return bytesToHex(seed32);
}

export function seedFromHex(hex) {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new IdentityError("SECRET_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return hexToBytes(clean);
}

/* --------------------------------------------------------- message signing */

const INVISIBLE_CATEGORY_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

/** Mirrors normalize_message() */
export function normalizeMessage(text) {
  if (typeof text !== "string") throw new ProtocolError("message text must be a string");
  const normalized = text.replace(INVISIBLE_CATEGORY_RE, " ").trim();
  if (!normalized) throw new ProtocolError("message has no visible text after normalization");
  if (normalized.length > MAX_MESSAGE_CHARS) {
    throw new ProtocolError(
      `message has ${normalized.length} characters; maximum is ${MAX_MESSAGE_CHARS}`
    );
  }
  return normalized;
}

export function validateName(value, label = "room") {
  if (typeof value !== "string" || !NAME_RE.test(value)) {
    throw new ProtocolError(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$`);
  }
  return value;
}

export function validateNonce(value) {
  const nonce = String(value);
  if (!NONCE_RE.test(nonce)) throw new ProtocolError("nonce must contain 1-19 ASCII digits");
  return nonce;
}

/** Mirrors next_nonce(): a high-resolution, monotonically-increasing nonce. */
let lastNonce = 0n;
export function nextNonce() {
  let candidate = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  if (candidate <= lastNonce) candidate = lastNonce + 1n;
  lastNonce = candidate;
  return validateNonce(candidate.toString());
}

/** Mirrors message_payload(): builds the exact `room|nonce|text` signed bytes. */
export function messagePayload(room, nonce, text) {
  const validRoom = validateName(room);
  const validNonce = validateNonce(nonce);
  const normalized = normalizeMessage(text);
  const payload = new TextEncoder().encode(`${validRoom}|${validNonce}|${normalized}`);
  return { normalized, payload };
}

/** Mirrors sign_bytes(): returns an 86-char unpadded base64url signature. */
export async function signBytes(privateKey, payload) {
  const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payload);
  const encoded = b64urlEncode(new Uint8Array(sigBuf));
  if (!SIGNATURE_RE.test(encoded)) throw new IdentityError("generated an invalid Ed25519 signature encoding");
  return encoded;
}

/** Mirrors verify_bytes(): verifies a signature against a did:key. */
export async function verifyBytes(did, signature, payload) {
  if (!SIGNATURE_RE.test(signature || "")) {
    throw new ProtocolError("signature must contain 86 unpadded base64url characters");
  }
  const sigBytes = b64urlDecode(signature);
  const publicKeyRaw = publicKeyBytesFromDid(did);
  const publicKey = await crypto.subtle.importKey("raw", publicKeyRaw, { name: "Ed25519" }, true, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, sigBytes, payload);
  if (!ok) throw new IdentityError("signature does not match the DID and payload");
}

/* -------------------------------------------------- contribution proof v1 */

function validateArtifactUrl(url) {
  if (typeof url !== "string" || url !== url.trim()) {
    throw new ProtocolError("artifact URL must not contain surrounding whitespace");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProtocolError("artifact URL is malformed");
  }
  if (parsed.protocol !== "https:" || parsed.hash) {
    throw new ProtocolError("artifact URL must be an absolute HTTPS URL without a fragment");
  }
  if (parsed.username || parsed.password) {
    throw new ProtocolError("artifact URL must not contain embedded credentials");
  }
  return url;
}

function validateCommit(commit) {
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) {
    throw new ProtocolError("commit must be a complete 40- or 64-character hexadecimal revision");
  }
  return commit.toLowerCase();
}

/** Mirrors contribution_payload(): canonical, sorted-key JSON bytes. */
export function contributionPayload(artifactUrl, commit) {
  const url = validateArtifactUrl(artifactUrl);
  const lowerCommit = validateCommit(commit);
  // Field order below is already alphabetical (artifact_url, commit, schema),
  // matching Python's json.dumps(..., sort_keys=True).
  const record = { artifact_url: url, commit: lowerCommit, schema: "technocore-contribution-v1" };
  const canonical = JSON.stringify(record);
  return new TextEncoder().encode(canonical);
}

/** Mirrors create_contribution_proof(). */
export async function createContributionProof(privateKey, did, artifactUrl, commit) {
  const payload = contributionPayload(artifactUrl, commit);
  const signature = await signBytes(privateKey, payload);
  return {
    schema: "technocore-contribution-proof-v1",
    did,
    artifact_url: artifactUrl,
    commit: commit.toLowerCase(),
    signature,
  };
}

/** Mirrors verify_contribution_proof(). Throws on any mismatch. */
export async function verifyContributionProof(proof) {
  if (!proof || proof.schema !== "technocore-contribution-proof-v1") {
    throw new ProtocolError("unsupported contribution proof schema");
  }
  for (const field of ["did", "artifact_url", "commit", "signature"]) {
    if (typeof proof[field] !== "string") {
      throw new ProtocolError("contribution proof is missing required string fields");
    }
  }
  const payload = contributionPayload(proof.artifact_url, proof.commit);
  await verifyBytes(proof.did, proof.signature, payload);
}
