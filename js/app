/**
 * app.js — UI controller for The Dossier.
 * Pure client-side. No data leaves the browser except the public fields
 * (did, sig, nonce, text) sent directly to Technocore, exactly as the CLI
 * this mirrors (technocore_agent.py) does.
 */

import * as C from "./crypto.js";
import { postSignedMessage, readRoom, followRoom, NetworkError, DEFAULT_BASE_URL } from "./technocore.js";
import {
  createEncryptedBackup,
  unlockEncryptedBackup,
  unlockFromSecretKeyHex,
  revealSecretKeyHex,
  downloadJson,
  VaultError,
} from "./vault.js";

/* ------------------------------------------------------------------ state */

const state = {
  identity: null, // { privateKey, publicKeyRaw, did }
  lobby: { room: null, seq: null, text: null },
  contribution: { url: "", audience: "", topic: "" },
  record: { room: null, seq: null, text: null },
  proof: null,
  watchAbort: null,
  roomMessages: [],
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

/* --------------------------------------------------------- entry / tabs */

const ENTRIES = ["identity", "lobby", "contribution", "record", "share"];

function setEntry(name) {
  for (const e of ENTRIES) {
    $(`panel-${e}`).classList.toggle("hidden", e !== name);
  }
  document.querySelectorAll(".entry-tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.entry === name));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  $("vLobby").textContent = state.lobby.seq ? `/${state.lobby.room} · seq ${state.lobby.seq}` : "—";
  $("vContrib").textContent = state.contribution.url
    ? state.contribution.url.replace(/^https?:\/\//, "").slice(0, 28) + (state.contribution.url.length > 34 ? "…" : "")
    : "—";
  $("vRecord").textContent = state.record.seq ? `/${state.record.room} · seq ${state.record.seq}` : "—";
  $("vProof").textContent = state.proof ? "signed" : "—";

  const steps = [
    !!state.identity,
    !!state.lobby.seq,
    !!state.contribution.url,
    !!state.record.seq,
    !!(state.lobby.seq && state.record.seq),
  ];
  const done = steps.filter(Boolean).length;
  const pct = Math.round((done / steps.length) * 100);
  $("progressFill").style.width = pct + "%";
  $("progressLabel").textContent = `${pct}٪ تکمیل (${done}/${steps.length})`;
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
    onIdentityReady();
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
    onIdentityReady();
    showResult("identityResult", `هویت با موفقیت بازیابی شد.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `خطا: ${err.message}`, true);
  }
});

$("btnUnlockBackup").addEventListener("click", async () => {
  const file = $("backupFileInput").files[0];
  const passphrase = $("unlockPassphrase").value;
  if (!file) {
    showResult("identityResult", "ابتدا یک فایل بک‌آپ انتخاب کنید.", true);
    return;
  }
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    state.identity = await unlockEncryptedBackup(backup, passphrase);
    onIdentityReady();
    showResult("identityResult", `بک‌آپ باز شد.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `خطا: ${err.message}`, true);
  }
});

function onIdentityReady() {
  renderSeal();
  $("didDisplay").textContent = state.identity.did;
  $("saveSection").classList.remove("hidden");
  $("secretReveal").classList.add("hidden");
  $("secretReveal").textContent = "";
  updateVault();
}

attachCopy($("btnCopyDid"), () => state.identity?.did || "");

$("btnDownloadBackup").addEventListener("click", async () => {
  if (!state.identity) return;
  const p1 = $("passphrase1").value;
  const p2 = $("passphrase2").value;
  if (p1 !== p2) {
    alert("پس‌فریزها یکسان نیستند.");
    return;
  }
  try {
    const backup = await createEncryptedBackup(state.identity, p1);
    downloadJson(`flop-vault-${state.identity.did.slice(-10)}.json`, backup);
  } catch (err) {
    alert("خطا: " + err.message);
  }
});

$("btnRevealSecret").addEventListener("click", async () => {
  if (!state.identity) return;
  const box = $("secretReveal");
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    box.textContent = "";
    $("btnRevealSecret").textContent = "نمایش SECRET_KEY";
    return;
  }
  const hex = await revealSecretKeyHex(state.identity);
  box.textContent = "SECRET_KEY: " + hex + "\n⚠ این مقدار را هرگز در جایی عمومی paste نکنید.";
  box.classList.remove("hidden");
  $("btnRevealSecret").textContent = "پنهان کردن SECRET_KEY";
});

$("confirmSaved").addEventListener("change", (e) => {
  $("btnGoLobby").disabled = !e.target.checked;
});

$("btnGoLobby").addEventListener("click", () => setEntry("lobby"));

$("btnLockFromIdentity").addEventListener("click", lockVault);
$("btnLockVault").addEventListener("click", lockVault);

function lockVault() {
  if (!confirm("هویت و تمام داده‌های محلی این نشست پاک می‌شود و صفحه از نو بارگذاری می‌شود. ادامه می‌دهید؟")) return;
  if (state.watchAbort) state.watchAbort.abort();
  location.reload();
}

/* ============================================================ ENTRY 02 */

$("btnSignLobby").addEventListener("click", async () => {
  if (!requireIdentity("lobbyResult")) return;
  const room = $("lobbyRoom").value.trim();
  const text = $("lobbyText").value;
  try {
    const response = await postSignedMessage(state.identity, room, text);
    state.lobby = { room, seq: response.posted.seq, text: response.posted.text };
    markTabDone("lobby");
    updateVault();
    showResult("lobbyResult", `ثبت شد. room=${room} seq=${response.posted.seq}\ntext: ${response.posted.text}`);
  } catch (err) {
    showResult("lobbyResult", `خطا: ${err.message}`, true);
  }
});

function requireIdentity(resultElId) {
  if (!state.identity) {
    showResult(resultElId, "ابتدا در Exhibit 01 یک هویت بسازید یا بازیابی کنید.", true);
    return false;
  }
  return true;
}

function renderRoomMessages(messages) {
  const container = $("roomReader");
  if (!messages.length) {
    container.innerHTML = `<div class="room-empty">هنوز پیامی در این روم نیست.</div>`;
    return;
  }
  container.innerHTML = messages
    .slice(-100)
    .map(
      (m) => `
      <div class="room-msg">
        <div class="meta">seq ${m.seq ?? "?"} · ${m.from ? shortDid(m.from) : "?"} · ${m.ts ?? ""}</div>
        <div>${escapeHtml(String(m.text ?? ""))}</div>
      </div>`
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("btnRefreshRoom").addEventListener("click", async () => {
  const room = $("watchRoomInput").value.trim();
  try {
    const response = await readRoom(room, { limit: 30 });
    state.roomMessages = response.messages;
    renderRoomMessages(state.roomMessages);
  } catch (err) {
    $("roomReader").innerHTML = `<div class="room-empty">خطا: ${escapeHtml(err.message)}</div>`;
  }
});

$("btnWatchRoom").addEventListener("click", async () => {
  const btn = $("btnWatchRoom");
  if (state.watchAbort) {
    state.watchAbort.abort();
    state.watchAbort = null;
    btn.textContent = "شروع مشاهدهٔ زنده";
    return;
  }
  const room = $("watchRoomInput").value.trim();
  btn.textContent = "توقف مشاهدهٔ زنده";
  const controller = new AbortController();
  state.watchAbort = controller;

  try {
    const initial = await readRoom(room, { limit: 30, signal: controller.signal });
    state.roomMessages = initial.messages;
    renderRoomMessages(state.roomMessages);

    for await (const response of followRoom(room, { since: initial.last_seq, wait: 10, signal: controller.signal })) {
      state.roomMessages = [...state.roomMessages, ...response.messages].slice(-100);
      renderRoomMessages(state.roomMessages);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      $("roomReader").innerHTML += `<div class="room-empty">مشاهدهٔ زنده متوقف شد: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    if (state.watchAbort === controller) {
      state.watchAbort = null;
      btn.textContent = "شروع مشاهدهٔ زنده";
    }
  }
});

$("btnGoContribution").addEventListener("click", () => setEntry("contribution"));

/* ============================================================ ENTRY 03 */

["contribUrl", "contribAudience", "contribTopic"].forEach((id) => {
  $(id).addEventListener("input", () => {
    state.contribution = {
      url: $("contribUrl").value.trim(),
      audience: $("contribAudience").value.trim(),
      topic: $("contribTopic").value.trim(),
    };
    updateVault();
  });
});

$("btnGoRecord").addEventListener("click", () => {
  composeRecordText();
  setEntry("record");
});

function composeRecordText() {
  const { url, audience, topic } = state.contribution;
  const text = `I published a Technocore contribution: ${url || "PUBLIC_CONTRIBUTION_URL"}. It helps ${
    audience || "AUDIENCE"
  } understand ${topic || "TOPIC"}.`;
  const field = $("recordText");
  if (!field.value || field.value === state.lastAutoRecordText) {
    field.value = text;
    state.lastAutoRecordText = text;
  }
}

/* ============================================================ ENTRY 04 */

$("btnSignRecord").addEventListener("click", async () => {
  if (!requireIdentity("recordResult")) return;
  const room = $("recordRoom").value.trim();
  const text = $("recordText").value;
  try {
    const response = await postSignedMessage(state.identity, room, text);
    state.record = { room, seq: response.posted.seq, text: response.posted.text };
    markTabDone("record");
    updateVault();
    showResult("recordResult", `ثبت شد. room=${room} seq=${response.posted.seq}\ntext: ${response.posted.text}`);
  } catch (err) {
    showResult("recordResult", `خطا: ${err.message}`, true);
  }
});

$("btnSignProof").addEventListener("click", async () => {
  if (!requireIdentity("proofResult")) return;
  const url = $("proofRepoUrl").value.trim();
  const commit = $("proofCommit").value.trim();
  try {
    const proof = await C.createContributionProof(state.identity.privateKey, state.identity.did, url, commit);
    state.proof = proof;
    updateVault();
    showResult("proofResult", JSON.stringify(proof, null, 2));
    $("btnDownloadProof").classList.remove("hidden");
  } catch (err) {
    showResult("proofResult", `خطا: ${err.message}`, true);
  }
});

$("btnDownloadProof").addEventListener("click", () => {
  if (!state.proof) return;
  downloadJson(`technocore-proof-${state.identity.did.slice(-10)}.json`, state.proof);
});

$("btnVerifyProof").addEventListener("click", async () => {
  const file = $("verifyFileInput").files[0];
  if (!file) {
    showResult("verifyResult", "ابتدا یک فایل proof انتخاب کنید.", true);
    return;
  }
  try {
    const proof = JSON.parse(await file.text());
    await C.verifyContributionProof(proof);
    showResult("verifyResult", `✅ اثبات معتبر است برای:\n${proof.did}`);
  } catch (err) {
    showResult("verifyResult", `❌ نامعتبر: ${err.message}`, true);
  }
});

$("btnGoShare").addEventListener("click", () => {
  composeShareText();
  setEntry("share");
});

/* ============================================================ ENTRY 05 */

function composeShareText() {
  const did = state.identity?.did || "YOUR_PUBLIC_DID";
  const url = state.contribution.url || "PUBLIC_CONTRIBUTION_URL";
  const room = state.record.room || "technocore";
  const seq = state.record.seq ?? "YOUR_SEQUENCE";
  const text = `I published a contribution for Technocore by @flop_labs.

Contribution: ${url}
Agent DID: ${did}
Signed Technocore record: room ${room}, sequence ${seq}`;
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

$("btnDownloadSummary").addEventListener("click", () => {
  const summary = {
    schema: "flop-dossier-case-summary-v1",
    did: state.identity?.did || null,
    lobby: state.lobby,
    contribution: state.contribution,
    record: state.record,
    git_proof: state.proof,
    base_url: DEFAULT_BASE_URL,
    generated_at: new Date().toISOString(),
  };
  downloadJson(`flop-case-summary-${(state.identity?.did || "unsigned").slice(-10)}.json`, summary);
});

$("btnPrintSummary").addEventListener("click", () => window.print());

/* ------------------------------------------------------------------ init */

updateVault();
renderSeal();
