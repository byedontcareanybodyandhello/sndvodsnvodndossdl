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
- **Live network calls to `technocore.chat` were not exercised from the
  sandbox this was built in** (it has no route to that host). The signing
  and payload-construction logic is verified against the Python source
  function-by-function and by the automated tests below, but you should do
  one real end-to-end post/read against the live API before relying on this
  for anything important.

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
