/**
 * app.js — UI controller: wires the crypto and network modules to the DOM.
 */

import * as C from "./crypto.js";
import { postSignedMessage } from "./technocore.js";
import { unlockFromSecretKeyHex, revealSecretKeyHex } from "./vault.js";

/* ------------------------------------------------------------------ state */

const RECORD_ROOM = "technocore";
const LOBBY_ROOM = "lobby";
const HUMANS_BASE = "https://technocore.chat/humans#r/";

const state = {
  identity: null, // { privateKey, publicKeyRaw, did }
  lobby: { room: null, seq: null, text: null, nonce: null },
  contribution: { url: "", description: "" },
  record: { room: null, seq: null, text: null, nonce: null },
  lastAutoRecordText: "",
};

const $ = (id) => document.getElementById(id);

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
      button.textContent = "Copied ✓";
      setTimeout(() => (button.textContent = old), 1400);
    } catch {
      /* clipboard may be unavailable; ignore */
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

/** Explains where to find a published message on the live server. */
function humansLookupNoteHtml(room, seq) {
  const url = HUMANS_BASE + room;
  return (
    `To see this message on the live server, go to <a href="${url}" target="_blank" rel="noopener">technocore.chat/humans#r/${room}</a> ` +
    `and look for <strong>#${seq}</strong> or your DID in the "${room}" room's list — that number is not a room name, ` +
    `it's where your message sits <em>inside</em> the "${room}" room.`
  );
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
      // Reachable as soon as the lobby post is confirmed, so the person can
      // announce their new identity on X right away. composeShareText()
      // adjusts the post text depending on how far they've gotten.
      return !!state.lobby.seq;
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
  $("progressLabel").textContent = `${pct}% complete (${done}/${steps.length})`;

  updateTabGating();
}

function renderSeal() {
  const badge = $("sealBadge");
  if (!state.identity) {
    badge.className = "seal-badge empty";
    badge.innerHTML = `<span class="fp">No identity created yet</span>`;
    return;
  }
  badge.className = "seal-badge";
  badge.innerHTML = `<span class="fp">${shortDid(state.identity.did)}</span>`;
}

/* ============================================================ ENTRY 01 */

$("btnCreateIdentity").addEventListener("click", async () => {
  try {
    state.identity = await C.generateIdentity();
    await onIdentityReady();
    showResult("identityResult", `New identity created.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `Error: ${err.message}`, true);
  }
});

$("btnShowRestore").addEventListener("click", () => {
  $("restorePanel").classList.toggle("hidden");
});

$("btnRestoreFromSecret").addEventListener("click", async () => {
  try {
    const hex = $("secretKeyInput").value;
    state.identity = await unlockFromSecretKeyHex(hex);
    await onIdentityReady();
    showResult("identityResult", `Identity restored successfully.\nPUBLIC_DID: ${state.identity.did}`);
  } catch (err) {
    showResult("identityResult", `Error: ${err.message}`, true);
  }
});

async function onIdentityReady() {
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
  if (!confirm("This will erase your identity and all local session data, and reload the page. Continue?")) return;
  location.reload();
}

/* ============================================================ ENTRY 02 */

function renderLobbyPanel() {
  const published = !!state.lobby.seq;
  $("lobbyFormSection").classList.toggle("hidden", published);
  $("lobbyReceiptSection").classList.toggle("hidden", !published);
  if (published) {
    $("lobbyReceipt").innerHTML = receiptHtml([
      ["ROOM", LOBBY_ROOM],
      ["MESSAGE", state.lobby.text],
      ["IDENTITY", shortDid(state.identity.did)],
      ["SEQUENCE", "#" + state.lobby.seq],
      ["NONCE", state.lobby.nonce],
      ["DELIVERY", "Confirmed", "status"],
    ]);
    $("lobbyReceiptNote").innerHTML = humansLookupNoteHtml(LOBBY_ROOM, state.lobby.seq);
  }
}

$("btnSignLobby").addEventListener("click", async () => {
  if (!requireIdentity("lobbyResult")) return;
  const text = $("lobbyText").value;
  const btn = $("btnSignLobby");
  btn.disabled = true;
  btn.textContent = "Publishing…";
  hideResult("lobbyResult");
  try {
    const response = await postSignedMessage(state.identity, LOBBY_ROOM, text);
    state.lobby = {
      room: LOBBY_ROOM,
      seq: response.posted.seq,
      text: response.posted.text,
      nonce: response.posted.nonce,
    };
    markTabDone("lobby");
    updateVault();
    renderLobbyPanel();
  } catch (err) {
    showResult("lobbyResult", `Error: ${err.message} — please try again.`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign & publish to Lobby";
  }
});

function requireIdentity(resultElId) {
  if (!state.identity) {
    showResult(resultElId, "Create or restore an identity in Exhibit 01 first.", true);
    return false;
  }
  return true;
}

$("btnGoContribution").addEventListener("click", () => setEntry("contribution"));
$("btnGoShareEarly").addEventListener("click", () => setEntry("share"));

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
    $("recordReceiptNote").innerHTML = humansLookupNoteHtml(RECORD_ROOM, state.record.seq);
  } else {
    composeRecordText();
  }
}

$("btnSignRecord").addEventListener("click", async () => {
  if (!requireIdentity("recordResult")) return;
  const text = $("recordText").value;
  const btn = $("btnSignRecord");
  btn.disabled = true;
  btn.textContent = "Publishing…";
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
    showResult("recordResult", `Error: ${err.message} — please try again.`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign & publish record";
  }
});

$("btnGoShare").addEventListener("click", () => setEntry("share"));

/* ============================================================ ENTRY 05 */

function composeShareText() {
  const did = state.identity?.did || "YOUR_PUBLIC_DID";
  const lobbyPart = state.lobby.seq ? `${LOBBY_ROOM}#${state.lobby.seq}` : "—";
  const complete = !!state.record.seq;

  let text;
  if (complete) {
    const contribPart = state.contribution.url || "—";
    const recordPart = `${RECORD_ROOM}#${state.record.seq}`;
    text = `I published a useful Technocore contribution.

DID: ${did}
Lobby: ${lobbyPart}
Contribution: ${contribPart}
Technocore: ${recordPart}

@flop_labs`;
    $("shareLede").textContent = "Post this on X so the public evidence of your contribution gets seen.";
  } else {
    text = `I just created a signed, public Technocore identity and posted my first entry.

DID: ${did}
Lobby: ${lobbyPart}

@flop_labs`;
    $("shareLede").textContent =
      "You haven't finished the Contribution and Record steps yet — you can announce your new identity right now, and come back here later to post the complete version.";
  }
  $("shareText").value = text;
  $("btnOpenX").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
}

$("btnCopyShare").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("shareText").value);
    const btn = $("btnCopyShare");
    const old = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = old), 1400);
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ init */

updateVault();
renderSeal();
