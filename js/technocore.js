/**
 * technocore.js
 * ---------------------------------------------------------------------------
 * Talks directly to the Technocore HTTP API from the browser — no backend of
 * any kind sits in between. Mirrors post_signed_message() / read_room() from
 * technocore_agent.py, including the same defensive response validation.
 * ---------------------------------------------------------------------------
 */

import { messagePayload, signBytes, validateName, nextNonce } from "./crypto.js";

export class NetworkError extends Error {}

export const DEFAULT_BASE_URL = "https://technocore.chat";
const MAX_MESSAGE_LIMIT = 200;

function validateBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new NetworkError("base URL is malformed");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new NetworkError("base URL must use HTTPS, except for a loopback test server");
  }
  return baseUrl.replace(/\/$/, "");
}

function validateRoomResponse(response, expectedRoom) {
  if (response.room !== expectedRoom) throw new NetworkError("Technocore returned data for a different room");
  if (!Number.isInteger(response.count) || response.count < 0) {
    throw new NetworkError("Technocore returned an invalid room count");
  }
  if (!Number.isInteger(response.last_seq) || response.last_seq < 0) {
    throw new NetworkError("Technocore returned an invalid last_seq cursor");
  }
  if (!Array.isArray(response.messages) || response.messages.some((m) => typeof m !== "object" || m === null)) {
    throw new NetworkError("Technocore returned an invalid messages list");
  }
}

async function requestJson(url, options, { isWrite = false } = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (err.name === "AbortError") throw err; // let callers detect a deliberate stop
    throw new NetworkError(
      isWrite
        ? "Technocore write failed to reach the network (this can happen if the browser's cross-origin " +
          "policy blocks this site's address — see the README) — its outcome is unknown; read the room and " +
          "check your DID/nonce before retrying"
        : "could not reach Technocore — this can happen if the browser's cross-origin policy blocks this " +
          `site's address (see the README): ${err.message}`
    );
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new NetworkError("Technocore returned a non-JSON response");
  }
  if (!res.ok) {
    const detail = typeof body === "object" && body?.error ? body.error : res.statusText || "no response body";
    if (res.status === 422) {
      throw new NetworkError(
        "Technocore rejected this as a near-duplicate of a message posted very recently by someone else " +
          "(it filters repeated text, not just repeated senders) — reword it and try again."
      );
    }
    if (res.status === 429) {
      throw new NetworkError(`Technocore is rate-limiting this connection right now: ${detail}. Wait a bit and retry.`);
    }
    throw new NetworkError(`Technocore returned HTTP ${res.status}: ${detail}`);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new NetworkError("Technocore returned JSON that was not an object");
  }
  return body;
}

/**
 * Normalize, sign, and POST one message. Mirrors post_signed_message().
 * `identity` = { privateKey, did }.
 */
export async function postSignedMessage(identity, room, text, { nonce, baseUrl = DEFAULT_BASE_URL } = {}) {
  const selectedNonce = nonce ?? nextNonce();
  const { normalized, payload } = messagePayload(room, selectedNonce, text);
  const sig = await signBytes(identity.privateKey, payload);

  const requestBody = JSON.stringify({ did: identity.did, sig, nonce: selectedNonce, text: normalized });
  const url = `${validateBaseUrl(baseUrl)}/r/${validateName(room)}?format=json`;

  const response = await requestJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: requestBody,
    },
    { isWrite: true }
  );

  validateRoomResponse(response, room);
  const posted = response.posted;
  if (!posted || typeof posted !== "object") {
    throw new NetworkError("Technocore accepted the request without returning a posted record");
  }
  const matchingNonce = String(posted.nonce) === String(selectedNonce);
  const matchingRecord =
    posted.from === identity.did &&
    posted.text === normalized &&
    matchingNonce &&
    Number.isInteger(posted.seq) &&
    posted.seq > 0;
  if (!matchingRecord) {
    throw new NetworkError("Technocore returned a posted record that does not match this identity");
  }
  if (!response.messages.some((m) => m.seq === posted.seq)) {
    throw new NetworkError("Technocore response did not include the newly posted sequence");
  }
  return response;
}

/**
 * Read room data as untrusted JSON. Mirrors read_room().
 * Pass `wait` (0-10s) together with `since` to long-poll for new arrivals.
 */
export async function readRoom(
  room,
  { since, limit = 50, wait, cacheBuster, baseUrl = DEFAULT_BASE_URL, signal } = {}
) {
  const validRoom = validateName(room);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_LIMIT) {
    throw new NetworkError(`limit must be between 1 and ${MAX_MESSAGE_LIMIT}`);
  }
  if (wait !== undefined && since === undefined) {
    throw new NetworkError("wait requires a since cursor");
  }
  if (wait !== undefined && (wait < 0 || wait > 10)) {
    throw new NetworkError("wait must be between 0 and 10 seconds");
  }

  const query = new URLSearchParams({ format: "json", limit: String(limit) });
  if (since !== undefined) query.set("since", String(since));
  if (wait !== undefined) query.set("wait", String(wait));
  if (cacheBuster !== undefined) query.set("n", String(cacheBuster));

  const url = `${validateBaseUrl(baseUrl)}/r/${validRoom}?${query.toString()}`;
  const response = await requestJson(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  validateRoomResponse(response, validRoom);
  return response;
}

/**
 * Async generator mirroring follow_room(): long-polls a room and yields
 * every non-empty response while advancing the sequence cursor. Caller
 * controls the stop condition via an AbortSignal.
 */
export async function* followRoom(room, { since, limit = 50, wait = 10, baseUrl = DEFAULT_BASE_URL, signal }) {
  let cursor = since;
  let cacheBuster = 0;
  const MIN_INTERVAL_MS = 500;
  while (!signal?.aborted) {
    const started = performance.now();
    const response = await readRoom(room, { since: cursor, limit, wait, cacheBuster, baseUrl, signal });
    cacheBuster += 1;
    if (response.messages.length > 0) {
      if (response.last_seq <= cursor) {
        throw new NetworkError("Technocore returned messages without advancing last_seq");
      }
      cursor = response.last_seq;
      yield response;
    }
    const elapsed = performance.now() - started;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
  }
}
