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
  console.log("caseNumber text (should be replaced if app.js ran):", $("caseNumber").textContent);
  console.assert($("btnCreateIdentity"), "create-identity button exists");
  console.assert($("vault"), "vault sidebar exists");

  // Click "Generate new identity" and confirm the UI actually updates.
  $("btnCreateIdentity").dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(300);

  const didText = $("didDisplay").textContent;
  console.log("identityResult says:", $("identityResult").textContent);
  console.log("DID after create:", didText);
  console.assert(didText.startsWith("did:key:z6Mk"), "DID rendered in the save section");
  console.assert(!$("saveSection").classList.contains("hidden"), "save section revealed");
  console.assert($("vDid").textContent !== "not created", "vault sidebar shows the DID");

  // Switch tabs.
  window.document.querySelector('.entry-tab[data-entry="lobby"]').dispatchEvent(
    new window.Event("click", { bubbles: true })
  );
  await wait(50);
  console.assert(!$("panel-lobby").classList.contains("hidden"), "lobby panel becomes visible");
  console.assert($("panel-identity").classList.contains("hidden"), "identity panel hides");

  // Fill contribution fields and confirm the record template auto-composes.
  $("contribUrl").value = "https://example.com/my-post";
  $("contribUrl").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("contribAudience").value = "new agents";
  $("contribAudience").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("contribTopic").value = "signing messages";
  $("contribTopic").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("btnGoRecord").dispatchEvent(new window.Event("click", { bubbles: true }));
  await wait(50);
  console.log("Auto-composed record text:", $("recordText").value);
  console.assert($("recordText").value.includes("https://example.com/my-post"), "record text picks up contribution URL");
  console.assert($("recordText").value.includes("new agents"), "record text picks up audience");

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
