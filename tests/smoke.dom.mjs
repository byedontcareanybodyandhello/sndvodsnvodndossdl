import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: pathToFileURL(path.join(root, "index.html")).href,
  runScripts: "outside-only",
  resources: "usable",
  pretendToBeVisual: true,
});

const { window } = dom;

// jsdom's <script type="module"> execution is unreliable, so instead we mirror
// a browser's global scope in Node and import the real js/app.js as a native
// ES module against jsdom's DOM. This exercises the exact shipped file.
globalThis.window = window;
globalThis.document = window.document;
if (!globalThis.navigator.clipboard) {
  globalThis.navigator.clipboard = { writeText: async () => {} };
}
globalThis.alert = (msg) => console.log("[alert]", msg);
globalThis.confirm = () => true;
globalThis.Blob = window.Blob;
globalThis.URL = window.URL;
globalThis.URL.createObjectURL = () => "blob:mock";
globalThis.URL.revokeObjectURL = () => {};
globalThis.Event = window.Event;
globalThis.AbortController = window.AbortController || globalThis.AbortController;
// fetch / crypto.subtle come from Node itself (same WebCrypto/WHATWG fetch a browser exposes).

const errors = [];
window.addEventListener("error", (e) => errors.push(e.error || e.message));

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await import(pathToFileURL(path.join(root, "js/app.js")).href);
  await wait(50);
  const $ = (id) => window.document.getElementById(id);

  console.log("Page title:", window.document.title);
  console.assert($("btnCreateIdentity"), "create-identity button exists");
  console.assert($("vault"), "vault sidebar exists");
  console.assert(!$("caseNumber"), "case-number masthead line was intentionally removed");

  // Before any identity exists, later steps must be gated off.
  const lobbyTabBefore = window.document.querySelector('.entry-tab[data-entry="lobby"]');
  const shareTabBefore = window.document.querySelector('.entry-tab[data-entry="share"]');
  console.assert(lobbyTabBefore.disabled, "lobby tab starts disabled with no identity yet");
  console.assert(shareTabBefore.disabled, "share tab starts disabled with no identity yet");
  lobbyTabBefore.dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(30);
  console.assert($("panel-lobby").classList.contains("hidden"), "clicking a gated tab must not reveal its panel");

  // Click "Generate new identity" and confirm the UI actually updates.
  $("btnCreateIdentity").dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(300);

  const didText = $("didDisplay").textContent;
  console.log("identityResult says:", $("identityResult").textContent);
  console.log("DID after create:", didText);
  console.assert(didText.startsWith("did:key:z6Mk"), "DID rendered in the save section");
  console.assert(!$("saveSection").classList.contains("hidden"), "save section revealed");
  console.assert($("vDid").textContent !== "not created", "vault sidebar shows the DID");
  console.assert($("secretReveal").textContent.length === 64, "SECRET_KEY (64 hex chars) auto-revealed after creation");
  console.assert(!lobbyTabBefore.disabled, "lobby tab becomes enabled once an identity exists");
  console.assert(shareTabBefore.disabled, "share tab stays gated until a lobby post succeeds");

  // Switch tabs — should now be allowed.
  lobbyTabBefore.dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(50);
  console.assert(!$("panel-lobby").classList.contains("hidden"), "lobby panel becomes visible");
  console.assert($("panel-identity").classList.contains("hidden"), "identity panel hides");
  console.assert(!$("lobbyFormSection").classList.contains("hidden"), "lobby form shown before anything is published");
  console.assert($("lobbyReceiptSection").classList.contains("hidden"), "lobby receipt hidden before publishing");

  // Contribution tab must still be gated (lobby hasn't been published to yet).
  const contribTab = window.document.querySelector('.entry-tab[data-entry="contribution"]');
  console.assert(contribTab.disabled, "contribution tab stays gated until a lobby post succeeds");

  const recordTab = window.document.querySelector('.entry-tab[data-entry="record"]');
  console.assert(recordTab.disabled, "record tab stays gated with no contribution URL yet");

  // Fill contribution fields directly (bypassing the gate) and confirm the
  // record template auto-composes from the new single description field.
  $("contribUrl").value = "https://example.com/my-post";
  $("contribUrl").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("contribDescription").value = "A short guide showing new agents how to sign a message.";
  $("contribDescription").dispatchEvent(new window.Event("input", { bubbles: true }));
  console.assert(!$("btnGoRecord").disabled, "continue-to-record enables once a URL is entered");
  console.assert(!recordTab.disabled, "record tab unlocks once a contribution URL exists");

  recordTab.dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(30);
  console.log("Auto-composed record text:", $("recordText").value);
  console.assert($("recordText").value.includes("https://example.com/my-post"), "record text picks up contribution URL");
  console.assert($("recordText").value.includes("A short guide"), "record text picks up the description field");

  if (errors.length) {
    console.error("UNCAUGHT WINDOW ERRORS:", errors);
    process.exit(1);
  }
  console.log("\nALL DOM SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error("DOM SMOKE TEST FAILED:", e);
  process.exit(1);
});
