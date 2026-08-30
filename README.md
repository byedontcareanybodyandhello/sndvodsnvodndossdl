# The Dossier — FLOP Contribution Case File

A pure client-side website that lets someone create a local Ed25519 `did:key`
identity, sign messages, and post them to **Technocore**
(`https://technocore.chat`) — the same protocol implemented by the CLI in
[`zunmax/technocore-did-starter`](https://github.com/zunmax/technocore-did-starter).

No backend. No build step. No analytics. The private key is generated in the
visitor's own browser via the native Web Crypto API and never leaves it,
except as a passphrase-encrypted backup file the visitor explicitly
downloads.

---

## 1. How this maps to `technocore_agent.py`

Every function in `js/crypto.js` and `js/technocore.js` is a direct,
line-by-line mirror of a function in the Python CLI, so the two speak the
exact same wire protocol. If you're auditing this against the original repo,
start here:

| Python (`technocore_agent.py`) | JavaScript (this project) | Notes |
|---|---|---|
| `Ed25519PrivateKey.generate()` | `crypto.js :: generateIdentity()` | Uses the browser's native `crypto.subtle`, not an external crypto library. |
| `did_from_private_key()` | `crypto.js :: didFromPublicKeyBytes()` | Same multicodec (`0xed01`) + base58btc + `z` construction. |
| `public_key_from_did()` | `crypto.js :: publicKeyBytesFromDid()` | Same 48-char / `z6Mk` / 34-byte validation. |
| base58btc alphabet + codec | `crypto.js :: base58btcEncode/Decode()` | Re-implemented with `BigInt`, no dependency. |
| `normalize_message()` | `crypto.js :: normalizeMessage()` | Same Unicode categories (`Cc,Cf,Cs,Co,Zl,Zp`) via JS `\p{}` regex, same 4096-char cap. |
| `message_payload()` | `crypto.js :: messagePayload()` | Same `room\|nonce\|text` byte layout. |
| `sign_bytes()` / `verify_bytes()` | `crypto.js :: signBytes()/verifyBytes()` | Same 86-char unpadded base64url signature. |
| `next_nonce()` | `crypto.js :: nextNonce()` | Nanosecond-scale, monotonically increasing, 1–19 digits. |
| `contribution_payload()` | `crypto.js :: contributionPayload()` | Same sorted-key, no-space canonical JSON. |
| `create_contribution_proof()` / `verify_contribution_proof()` | `crypto.js :: createContributionProof()/verifyContributionProof()` | Output is byte-for-byte compatible with the CLI's `verify-proof` command. |
| `post_signed_message()` | `technocore.js :: postSignedMessage()` | Same `POST /r/{room}?format=json` body and the same defensive response checks (matching `did`/`text`/`nonce`, `seq` present in `messages`). |
| `read_room()` / `follow_room()` | `technocore.js :: readRoom()/followRoom()` | Same query params, same 0.5s minimum poll interval, same `since`/`wait` long-poll contract. |

One deliberate difference: **there is no PEM import/export.** The Python CLI
encrypts `identity.pem` with `cryptography`'s `BestAvailableEncryption` and
never prints the raw seed, so there's nothing to import into a browser in
the first place. This site has its own, self-contained backup format
instead (§3) plus a raw 32-byte "SECRET_KEY" hex export/import, similar to
what `flop.gomtu.xyz` offers, for moving an identity between devices or
recovering it if the encrypted backup file is lost alongside its passphrase.

A neat consequence of following RFC 8410 closely: `identityFromSeed()`
rebuilds a minimal PKCS#8 document from just the 32-byte seed and imports it
with `crypto.subtle.importKey("pkcs8", ...)`. The browser derives the
matching public key internally — no external elliptic-curve math library is
needed anywhere in this project.

---

## 2. File layout

```
index.html            The 5-entry case file UI + Evidence Vault sidebar
css/styles.css         "The Dossier" design system (see §5)
js/crypto.js           Protocol primitives (keys, DIDs, signing, proofs)
js/technocore.js        Network layer (post / read / follow a Technocore room)
js/vault.js             Encrypted local backup (AES-GCM + PBKDF2) and session helpers
js/app.js               UI controller — wires the above to the DOM
tests/smoke.crypto.mjs  Node test: identity, signing, proof round-trips
tests/smoke.vault.mjs   Node test: encrypted backup create/unlock, wrong-passphrase rejection
tests/smoke.dom.mjs     Headless DOM test: loads the real page, clicks through the flow
```

---

## 3. Security model

- **Key generation and signing happen only in the browser**, via
  `crypto.subtle`. This code never transmits a private key or seed anywhere.
- **What goes to the network:** only `{did, sig, nonce, text}` on write, and
  plain `GET` requests on read — identical in shape to what the Python CLI
  sends.
- **Local backup:** on request, the 32-byte seed is encrypted with
  AES-GCM using a key derived from a user passphrase via PBKDF2-SHA256
  (300,000 iterations, random 16-byte salt, random 12-byte IV) and offered
  as a JSON file download. This file is never uploaded anywhere by the site.
- **No `localStorage`/`sessionStorage`/cookies are used for key material.**
  The live identity exists only as an in-memory `CryptoKey` for the current
  tab. Closing the tab or clicking "Lock Vault" clears it.
- **Room contents are treated as untrusted, public data** — the UI never
  executes or links anything from a room message; it only escapes and
  displays it as text.
- The "reveal SECRET_KEY" control is opt-in and off by default, with an
  explicit warning never to paste it anywhere.

## 4. Known limitations

- **No cross-compatibility with `identity.pem` files from the Python CLI.**
  This is by design on the CLI's side (it never exports the raw key) — see
  §1. If interop with existing `identity.pem` files becomes a real
  requirement later, it would need a PKCS#8 *encrypted* parser (e.g. via
  `pkijs`/`asn1js`) to match `cryptography`'s KDF/cipher choices exactly;
  that was deliberately left out to avoid a fragile, hard-to-verify
  compatibility shim.
- **Browser support for `Ed25519` in the native Web Crypto API** is broadly
  available in current Chrome, Edge, Firefox, and Safari, but not in older
  browser versions. There's no automatic fallback bundled in; if you need to
  support older browsers, the cleanest option is adding `@noble/ed25519` as
  a fallback path.
- **Cross-origin browser access is the one thing that could not be verified
  from here.** The live server's own source
  ([flop-labs/technocore-chat](https://github.com/flop-labs/technocore-chat))
  ships a `CHAT_CORS_ORIGINS` setting that defaults to *no browser origin
  trusted* — meaning a production deployment has to opt in to allowing
  direct in-browser requests from a page hosted elsewhere (e.g. this site on
  GitHub Pages). Other browser-only tools already doing exactly this against
  the same server strongly suggest it is enabled in production, but this
  could not be confirmed from a sandbox with no route to `technocore.chat`.
  **If "Sign & Publish" fails with a generic network error, this is the
  first thing to suspect.** A manual fallback that does not depend on
  browser CORS at all — because it isn't a browser request — is a plain
  terminal command, using the same GET-based write lane the server ships
  specifically for clients that cannot do a JSON `POST`:
  ```bash
  curl "https://technocore.chat/r/lobby/say-signed/<did>/<sig>/<nonce>/<url-encoded-text>"
  ```
  The Reveal-SECRET_KEY panel plus the `signBytes()`/`messagePayload()`
  functions in `crypto.js` have everything needed to construct that URL by
  hand if this ever comes up.

## 4a. Verified against the live protocol (added after reviewing flop-labs/technocore-chat)

The person who commissioned this site found the actual server repository —
[`flop-labs/technocore-chat`](https://github.com/flop-labs/technocore-chat),
which runs `technocore.chat` — and asked for it to be checked line by line
against this client. Findings:

- **Endpoint, body shape, signed payload (`room|nonce|text`), the 4096-char
  cap, the `^[a-z0-9][a-z0-9_-]{0,47}$` name pattern, the 86-char unpadded
  base64url signature, and the exact single-line Unicode sweep
  (`Cc,Cf,Cs,Co,Zl,Zp`) all match this project's implementation exactly**,
  confirmed against the server's own published manual at
  `https://technocore.chat/` and `/humans`.
- **Two real gaps were found and fixed as a result:**
  1. The server signs and stores whatever Unicode form it receives without
     normalizing it — `normalizeMessage()` now also applies `.normalize("NFC")`
     so this client's signatures are consistent regardless of how a given
     browser/OS composed the typed characters.
  2. The server **rejects near-duplicate text from anyone within a short
     window** (HTTP 422) — not just repeats from the same sender. The
     lobby message field used to ship with real, submittable placeholder
     text, which every visitor could plausibly submit unedited and collide
     on; it now ships empty with a hint instead, and a 422 response is
     surfaced with a specific, friendly explanation instead of a generic
     error.
- **`https://technocore.chat/humans#r/<room>` is the confirmed, real, public
  page for a person to see what's actually landed** in a room — this is
  now linked directly from the Lobby step and updated automatically after a
  successful post.
- **Honest disclosure worth passing on:** the service's own manual describes
  itself, twice, as *"a satellite service — not part of the FLOP
  protocol"* and states it *"settles nothing, holds no keys, and is not
  part of any protocol."* It is real, FLOP-Labs-run infrastructure that
  agents and people are clearly meant to use — but it does not itself claim
  to be the mechanism that determines any reward or official recognition.
  Treat a Technocore record as a public, verifiable trail of activity, not
  as a guaranteed credit toward anything.

## 4b. Live-tested fix: nonce size was corrupting real posts

After deployment, a real post attempt against the live server failed with
alternating errors — a generic network failure, and *"posted record does
not match this identity."* The cause: `nextNonce()` generated a
nanosecond-scale value (~19 digits), far past `Number.MAX_SAFE_INTEGER`
(2^53, ~16 digits). JSON has no separate integer type, so when the server
echoed that nonce back as a bare JSON number, the browser's own
`response.json()` silently rounded it to the nearest representable double —
a real post landing on the server, misreported as a mismatch on this end.

Fixed by switching to a millisecond-clock nonce (~13 digits, always exact in
a JS double), which the server's own manual explicitly names as valid
("a counter or a millisecond clock both work"). `tests/smoke.crypto.mjs` now
asserts every generated nonce stays within the safe-integer range and
survives a simulated JSON-number round trip, so this class of bug can't
silently come back.

## 4c. Live-tested fix: rate-limit errors were disguised as "non-JSON response"

Clicking Sign & Publish repeatedly in quick succession (retrying after an
error, or double-clicking) surfaced a confusing `"Technocore returned a
non-JSON response"` message. The real cause: the network layer called
`res.json()` before checking whether the response was even a success — but
the server's rate-limit response (HTTP 429, hit after ~30 writes/minute per
connection) doesn't necessarily come back as a JSON body, so parsing it as
JSON threw before the code ever got a chance to recognize the 429 and
explain it properly.

Fixed by always reading the raw response text first, *then* attempting to
parse it — so a 429 (or any other non-JSON error response) now surfaces its
actual status and body instead of a generic parse failure. The Lobby and
Record "Sign & Publish" buttons also now disable themselves while a request
is in flight, so an impatient extra click can't fire a second overlapping
request and cause exactly this situation.

## 4d. Simplified to a strict, locked, one-way flow

Based on direct feedback from testing the live site, the flow was reworked
to reduce both error surface and cognitive load:

- **Identity restore is SECRET_KEY-only.** The encrypted-backup-file path
  (passphrase + AES-GCM + PBKDF2, file upload/download) was removed
  entirely — one less thing to configure, one less way to make a mistake.
  A freshly created identity now auto-reveals its SECRET_KEY immediately
  (it's the only backup that exists), with a clear one-time warning.
- **Each step tab is gated** — `canAccessEntry()` in `app.js` only unlocks
  a step once the previous one is genuinely complete (identity created →
  lobby signed → contribution URL entered → record signed → share).
  Tabs for steps not yet reachable are visibly disabled, matching
  `flop.gomtu.xyz`'s one-way progression.
- **Lobby and Record steps lock after a successful post.** Once the server
  confirms a post, the input form is replaced by a read-only **receipt**
  (`ROOM`, `MESSAGE`, `IDENTITY`, `SEQUENCE`, `NONCE`, `DELIVERY: Confirmed`)
  — no further editing, no re-submitting, styled after the reference site's
  own confirmation panel. Returning to that step tab later in the same
  session shows the same locked receipt rather than a blank form.
- **The in-page live room reader was removed.** It duplicated what
  `https://technocore.chat/humans#r/lobby` already shows directly from the
  source of truth, and was an extra source of network errors. A direct link
  to that page is shown on the Lobby receipt instead.
- **Contribution step (Exhibit 03)** is now just the five self-check boxes,
  a contribution URL field, and a single free-text description field — the
  earlier content-ideas table and the separate audience/topic fields were
  removed.
- **Record step (Exhibit 04)** is now just the record text box and the
  Sign & Publish button. The optional Git-commit proof section and the
  proof-verification tool were removed from the UI (the underlying
  `createContributionProof()`/`verifyContributionProof()` functions and
  their tests remain in `crypto.js` for anyone who wants them later, just
  unused by the interface).
- **Share step (Exhibit 05)** now produces exactly:
  ```
  I published a useful Technocore contribution.

  DID: <your did>
  Lobby: lobby#<sequence>
  Contribution: <your url>
  Technocore: technocore#<sequence>

  @flop_labs
  ```
  with just a copy button and an "Open in X" button — the case-summary
  download and print buttons were removed.

## 5. Design

The visual language is "a case file for a cryptographic identity": every
action here produces a stamped, sequential exhibit, the DID becomes a
wax-seal badge, and the sidebar is an "Evidence Vault." Palette and type
tokens are collected at the top of `css/styles.css` — change `--seal`,
`--stamp-red`, `--ink`, and `--paper` there to retheme, or swap the Google
Fonts `@import` for a different display/body/mono trio.

## 6. Running it locally

Browsers block `type="module"` scripts from loading over `file://`, so serve
the folder instead of double-clicking `index.html`:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed local URL.

## 7. Deploying

This is a static site — any static host works with zero configuration:
Vercel, Netlify, GitHub Pages, Cloudflare Pages. Push the folder as-is; there
is no build step and no environment variables to set.

## 8. Testing

```bash
npm install     # installs jsdom, only needed for the optional DOM test
npm test
```

- `smoke.crypto.mjs` — identity generation, did:key derivation, message
  signing/verification, seed↔SECRET_KEY round trip, contribution proof
  create/verify (including a tamper-detection check).
- `smoke.vault.mjs` — encrypted backup create/unlock round trip and
  wrong-passphrase rejection.
- `smoke.dom.mjs` — loads the actual `index.html` + `js/app.js` in a headless
  DOM, clicks "Generate identity," switches tabs, and confirms the record
  template auto-fills from the contribution fields.

## 9. Disclaimer

This is an independent, community-built tool, not an official product of
Flop Labs or Technocore. Completing this flow **does not guarantee any
airdrop allocation** — it produces a public, verifiable trail of a
contribution and nothing more. Protocol logic is adapted from
[`zunmax/technocore-did-starter`](https://github.com/zunmax/technocore-did-starter)
(MIT licensed).
