/**
 * app.js — UI controller for The Dossier.
 * Pure client-side. No data leaves the browser except the public fields
 * (did, sig, nonce, text) sent directly to Technocore, exactly as the CLI
 * this mirrors (technocore_agent.py) does.
 */

import * as C from "./crypto.js";
import { postSignedMessage } from "./technocore.js";
import { unlockFromSecretKeyHex, revealSecretKeyHex } from "./vault.js";

/* ------------------------------------------------------------------ state */

const RECORD_ROOM = "technocore";

const state = {
  identity: null, // { privateKey, publicKeyRaw, did }
  lobby: { room: null, seq: null, text: null, nonce: null },
  contribution: { url: "", description: "" },
  record: { room: null, seq: null, text: null, nonce: null },
  lastAutoRecordText: "",
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------- masthead */

(function initMasthead() {
  const n = Math.floor(100000 + Math.random() * 900000);
  $("caseNumber").textContent = `CASE No. FLOP-${n} · OPENED ${new Date().toISOString().slice(0, 10)}`;
})();

/* --------------------------------------------------------------- helpers */

function shortDid(did) {
  if (!did) return "—";
  return did.slice(0, 16) + "…" + did.slice(-8);
}

function showResult(id, message, isError = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden", "err");
  if (isError) el.classList.add("err");
}

function hideResult(id) {
  $(id).classList.add("hidden");
}

function attachCopy(button, getText) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      const old = button.textContent;
      button.textContent = "کپی شد ✓";
      setTimeout(() => (button.textContent = old), 1400);
    } catch {
      /* clipboard may be unavailable; silently ignore */
    }
  });
}

function receiptHtml(rows) {
  return rows
    .map(
      ([k, v, extraClass]) =>
        `<div class="receipt-row ${extraClass || ""}"><span class="k">${k}</span><span class="v">${escapeHtml(
          String(v)
        )}</span></div>`
    )
    .join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* --------------------------------------------------------- entry / tabs */

const ENTRIES = ["identity", "lobby", "contribution", "record", "share"];

function canAccessEntry(name) {
  switch (name) {
    case "identity":
      return true;
    case "lobby":
      return !!state.identity;
    case "contribution":
      return !!state.lobby.seq;
    case "record":
      return !!state.contribution.url;
    case "share":
      return !!state.record.seq;
    default:
      return false;
  }
}

function setEntry(name) {
  if (!canAccessEntry(name)) return;
  for (const e of ENTRIES) {
    $(`panel-${e}`).classList.toggle("hidden", e !== name);
  }
  document.querySelectorAll(".entry-tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.entry === name));
  });
  if (name === "lobby") renderLobbyPanel();
  if (name === "record") renderRecordPanel();
  if (name === "share") composeShareText();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateTabGating() {
  document.querySelectorAll(".entry-tab").forEach((tab) => {
    const ok = canAccessEntry(tab.dataset.entry);
    tab.disabled = !ok;
    tab.classList.toggle("locked", !ok);
  });
}

document.querySelectorAll(".entry-tab").forEach((tab) => {
  tab.addEventListener("click", () => setEntry(tab.dataset.entry));
});

function markTabDone(entry) {
  document.querySelector(`.entry-tab[data-entry="${entry}"]`)?.classList.add("done");
}

/* --------------------------------------------------------------- vault */

function updateVault() {
  $("vDid").textContent = state.identity ? shortDid(state.identity.did) : "not created";
  $("vLobby").textContent = state.lobby.seq ? `lobby · seq ${state.lobby.seq}` : "—";
  $("vContrib").textContent = state.contribution.url
    ? state.contribution.url.replace(/^https?:\/\//, "").slice(0, 28) + (state.contribution.url.length > 34 ? "…" : "")
    : "—";
  $("vRecord").textContent = state.record.seq ? `${RECORD_ROOM} · seq ${state.record.seq}` : "—";

  const steps = [!!state.identity, !!state.lobby.seq, !!state.contribution.url, !!state.record.seq];
  const done = steps.filter(Boolean).length;
  const pct = Math.round((done / steps.length) * 100);
  $("progressFill").style.width = pct + "%";
  $("progressLabel").textContent = `${pct}٪ تکمیل (${done}/${steps.length})`;

  updateTabGating();
}

function renderSeal() {
  const badge = $("sealBadge");
  if (!state.identity) {
    badge.className = "seal-badge empty";
    badge.innerHTML = `<span class="fp">هنوز هویتی ساخته نشده</span>`;
    return;
  }
  badge.className = "seal-badge";
  badge.innerHTML = `<span class="fp">${shortDid(state.identity.did)}</span>`;
}

/* ============================================================ ENTRY 01 */

$("btnCreateIdentity").addEventListener("click", async () => {
  try {
    state.identity = await C.generateIdentity();
    await onIdentityReady({ revealSecret: true });
    showResult("identityResult", `هویت جدید ساخته شد.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `خطا: ${err.message}`, true);
  }
});

$("btnShowRestore").addEventListener("click", () => {
  $("restorePanel").classList.toggle("hidden");
});

$("btnRestoreFromSecret").addEventListener("click", async () => {
  try {
    const hex = $("secretKeyInput").value;
    state.identity = await unlockFromSecretKeyHex(hex);
    await onIdentityReady({ revealSecret: false });
    showResult("identityResult", `هویت با موفقیت بازیابی شد.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `خطا: ${err.message}`, true);
  }
});

async function onIdentityReady({ revealSecret }) {
  renderSeal();
  $("didDisplay").textContent = state.identity.did;
  $("saveSection").classList.remove("hidden");
  const hex = await revealSecretKeyHex(state.identity);
  $("secretReveal").textContent = hex;
  updateVault();
}

attachCopy($("btnCopyDid"), () => state.identity?.did || "");

$("confirmSaved").addEventListener("change", (e) => {
  $("btnGoLobby").disabled = !e.target.checked;
});

$("btnGoLobby").addEventListener("click", () => setEntry("lobby"));

$("btnLockFromIdentity").addEventListener("click", lockVault);
$("btnLockVault").addEventListener("click", lockVault);

function lockVault() {
  if (!confirm("هویت و تمام داده‌های محلی این نشست پاک می‌شود و صفحه از نو بارگذاری می‌شود. ادامه می‌دهید؟")) return;
  location.reload();
}

/* ============================================================ ENTRY 02 */

function renderLobbyPanel() {
  const published = !!state.lobby.seq;
  $("lobbyFormSection").classList.toggle("hidden", published);
  $("lobbyReceiptSection").classList.toggle("hidden", !published);
  if (published) {
    $("lobbyReceipt").innerHTML = receiptHtml([
      ["ROOM", "lobby"],
      ["MESSAGE", state.lobby.text],
      ["IDENTITY", shortDid(state.identity.did)],
      ["SEQUENCE", "#" + state.lobby.seq],
      ["NONCE", state.lobby.nonce],
      ["DELIVERY", "Confirmed", "status"],
    ]);
  }
}

$("btnSignLobby").addEventListener("click", async () => {
  if (!requireIdentity("lobbyResult")) return;
  const text = $("lobbyText").value;
  const btn = $("btnSignLobby");
  btn.disabled = true;
  btn.textContent = "در حال ارسال…";
  hideResult("lobbyResult");
  try {
    const response = await postSignedMessage(state.identity, "lobby", text);
    state.lobby = {
      room: "lobby",
      seq: response.posted.seq,
      text: response.posted.text,
      nonce: response.posted.nonce,
    };
    markTabDone("lobby");
    updateVault();
    renderLobbyPanel();
  } catch (err) {
    showResult("lobbyResult", `خطا: ${err.message} — دوباره تلاش کنید.`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "امضا و ارسال به لابی";
  }
});

function requireIdentity(resultElId) {
  if (!state.identity) {
    showResult(resultElId, "ابتدا در Exhibit 01 یک هویت بسازید یا بازیابی کنید.", true);
    return false;
  }
  return true;
}

$("btnGoContribution").addEventListener("click", () => setEntry("contribution"));

/* ============================================================ ENTRY 03 */

["contribUrl", "contribDescription"].forEach((id) => {
  $(id).addEventListener("input", () => {
    state.contribution = {
      url: $("contribUrl").value.trim(),
      description: $("contribDescription").value.trim(),
    };
    $("btnGoRecord").disabled = !state.contribution.url;
    updateVault();
  });
});

$("btnGoRecord").addEventListener("click", () => {
  setEntry("record");
});

function composeRecordText() {
  const { url, description } = state.contribution;
  const text = description
    ? `I published a Technocore contribution: ${url}. ${description}`
    : `I published a Technocore contribution: ${url}.`;
  const field = $("recordText");
  if (!field.value || field.value === state.lastAutoRecordText) {
    field.value = text;
    state.lastAutoRecordText = text;
  }
}

/* ============================================================ ENTRY 04 */

function renderRecordPanel() {
  const published = !!state.record.seq;
  $("recordFormSection").classList.toggle("hidden", published);
  $("recordReceiptSection").classList.toggle("hidden", !published);
  if (published) {
    $("recordReceipt").innerHTML = receiptHtml([
      ["ROOM", RECORD_ROOM],
      ["MESSAGE", state.record.text],
      ["IDENTITY", shortDid(state.identity.did)],
      ["SEQUENCE", "#" + state.record.seq],
      ["NONCE", state.record.nonce],
      ["DELIVERY", "Confirmed", "status"],
    ]);
  } else {
    composeRecordText();
  }
}

$("btnSignRecord").addEventListener("click", async () => {
  if (!requireIdentity("recordResult")) return;
  const text = $("recordText").value;
  const btn = $("btnSignRecord");
  btn.disabled = true;
  btn.textContent = "در حال ارسال…";
  hideResult("recordResult");
  try {
    const response = await postSignedMessage(state.identity, RECORD_ROOM, text);
    state.record = {
      room: RECORD_ROOM,
      seq: response.posted.seq,
      text: response.posted.text,
      nonce: response.posted.nonce,
    };
    markTabDone("record");
    updateVault();
    renderRecordPanel();
  } catch (err) {
    showResult("recordResult", `خطا: ${err.message} — دوباره تلاش کنید.`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "امضا و ارسال ثبت";
  }
});

$("btnGoShare").addEventListener("click", () => setEntry("share"));

/* ============================================================ ENTRY 05 */

function composeShareText() {
  const did = state.identity?.did || "YOUR_PUBLIC_DID";
  const lobbyPart = state.lobby.seq ? `lobby#${state.lobby.seq}` : "—";
  const contribPart = state.contribution.url || "—";
  const recordPart = state.record.seq ? `${RECORD_ROOM}#${state.record.seq}` : "—";
  const text = `I published a useful Technocore contribution.

DID: ${did}
Lobby: ${lobbyPart}
Contribution: ${contribPart}
Technocore: ${recordPart}

@flop_labs`;
  $("shareText").value = text;
  $("btnOpenX").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
}

$("btnCopyShare").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("shareText").value);
    const btn = $("btnCopyShare");
    const old = btn.textContent;
    btn.textContent = "کپی شد ✓";
    setTimeout(() => (btn.textContent = old), 1400);
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ init */

updateVault();
renderSeal();
