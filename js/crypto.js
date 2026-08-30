/**
 * crypto.js
 * Ed25519 identity generation, did:key derivation, message signing and
 * verification, and contribution-proof helpers. Uses only the browser's
 * native Web Crypto API (crypto.subtle) — no external cryptography library.
 * Private key material never leaves this module except as an encrypted
 * or plaintext seed export the user explicitly requests (see vault.js).
 */

export class ProtocolError extends Error {}
export class IdentityError extends Error {}

const MULTICODEC_ED25519 = new Uint8Array([0xed, 0x01]);
const MULTIBASE_LENGTH = 48;
const SIGNATURE_LENGTH = 86;
const MAX_MESSAGE_CHARS = 4096;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const NONCE_RE = /^[0-9]{1,19}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;
const COMMIT_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

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

/** Derives a did:key:z6Mk... identifier from a raw 32-byte Ed25519 public key. */
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

/** Recovers the raw 32-byte Ed25519 public key from a did:key:z6Mk... identifier. */
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

/** Generates a new Ed25519 identity. Returns { privateKey, publicKeyRaw, did }. */
export async function generateIdentity() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const did = didFromPublicKeyBytes(publicKeyRaw);
  return { privateKey: pair.privateKey, publicKeyRaw, did };
}

/**
 * Builds a minimal RFC 8410 PKCS#8 document containing only the 32-byte
 * Ed25519 seed. A spec-following WebCrypto implementation derives the
 * matching public key internally when this is imported.
 */
export function seedToPkcs8(seed32) {
  if (seed32.length !== 32) throw new IdentityError("seed must be 32 bytes");
  // 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 <32-byte seed>
  const header = hexToBytes("302e020100300506032b657004220420");
  return concatBytes(header, seed32);
}

/** Restores an identity from its raw 32-byte seed (the site's "SECRET_KEY"). */
export async function identityFromSeed(seed32) {
  const pkcs8 = seedToPkcs8(seed32);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKeyRaw = b64urlDecode(jwk.x);
  const did = didFromPublicKeyBytes(publicKeyRaw);
  return { privateKey, publicKeyRaw, did };
}

/** Exports the raw 32-byte seed from a live private key. Session-only; never persisted unencrypted. */
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

/**
 * Strips invisible/control Unicode categories, trims, applies NFC
 * normalization for consistent signatures across browsers and operating
 * systems, and enforces the message length limit.
 */
export function normalizeMessage(text) {
  if (typeof text !== "string") throw new ProtocolError("message text must be a string");
  const normalized = text.replace(INVISIBLE_CATEGORY_RE, " ").trim().normalize("NFC");
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

/**
 * Generates a millisecond-timestamp nonce, monotonically increasing within
 * this session and always within Number.MAX_SAFE_INTEGER so it round-trips
 * losslessly through a JSON parser.
 */
let lastNonce = 0n;
export function nextNonce() {
  let candidate = BigInt(Date.now());
  if (candidate <= lastNonce) candidate = lastNonce + 1n;
  lastNonce = candidate;
  return validateNonce(candidate.toString());
}

/** Builds the exact `room|nonce|text` bytes that get signed. */
export function messagePayload(room, nonce, text) {
  const validRoom = validateName(room);
  const validNonce = validateNonce(nonce);
  const normalized = normalizeMessage(text);
  const payload = new TextEncoder().encode(`${validRoom}|${validNonce}|${normalized}`);
  return { normalized, payload };
}

/** Signs payload bytes with an Ed25519 private key; returns an 86-char unpadded base64url signature. */
export async function signBytes(privateKey, payload) {
  const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payload);
  const encoded = b64urlEncode(new Uint8Array(sigBuf));
  if (!SIGNATURE_RE.test(encoded)) throw new IdentityError("generated an invalid Ed25519 signature encoding");
  return encoded;
}

/** Verifies a signature against a did:key and payload bytes. Throws on mismatch. */
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

/** Builds the canonical, sorted-key JSON bytes for a contribution proof. */
export function contributionPayload(artifactUrl, commit) {
  const url = validateArtifactUrl(artifactUrl);
  const lowerCommit = validateCommit(commit);
  const record = { artifact_url: url, commit: lowerCommit, schema: "technocore-contribution-v1" };
  const canonical = JSON.stringify(record);
  return new TextEncoder().encode(canonical);
}

/** Creates a signed contribution proof linking a DID to an artifact URL and commit. */
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

/** Verifies a contribution proof. Throws on any mismatch. */
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
