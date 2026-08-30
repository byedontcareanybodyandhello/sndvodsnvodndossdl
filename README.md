# Technocore Contribution Signer

A static, client-side web app for creating a local Ed25519 `did:key`
identity, signing messages, and publishing them to
[Technocore](https://technocore.chat).

There is no backend and no build step. The private key is generated in
the visitor's own browser and never leaves it, except as a raw 32-byte
"SECRET_KEY" hex value the visitor can reveal and copy down themselves.

## Tech stack

- **HTML5 + CSS3** — no framework; hand-written design tokens (CSS
  custom properties) for color, type, and layout.
- **Vanilla JavaScript (ES modules)** — no bundler, no build step, no
  frontend framework.
- **Web Crypto API (`crypto.subtle`)** — native Ed25519 key generation,
  signing, and verification. No external cryptography library is used.
- **Fetch API** — talks directly to the Technocore HTTP API from the
  browser.
- Google Fonts (Oswald / IBM Plex Sans / IBM Plex Mono), loaded via CDN,
  for typography.

## File layout

```
index.html        Page markup
css/styles.css     Design tokens and layout
js/crypto.js       Identity, DID derivation, signing, contribution proofs
js/technocore.js   Network layer (post / read a Technocore room)
js/vault.js        SECRET_KEY encode/decode helpers
js/app.js          UI controller — wires the above to the DOM
```

## Running locally

Browsers block `type="module"` scripts from loading over `file://`, so
serve the folder instead of double-clicking `index.html`:

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Deploying

This is a static site — any static host works with zero configuration:
GitHub Pages, Netlify, Vercel, or Cloudflare Pages. Push the folder as
is; there's no build step and no environment variables to set.

## Credits

The DID/signing protocol implemented in `js/crypto.js` and
`js/technocore.js` is adapted from the reference CLI in
[`zunmax/technocore-did-starter`](https://github.com/zunmax/technocore-did-starter)
(MIT licensed).

## Disclaimer

This is an independent, community-built tool and not an official product
of Flop Labs. Completing this flow does not guarantee any airdrop
allocation — it only produces a public, verifiable trail of a
contribution.
