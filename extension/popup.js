import { DEFAULT_SALT, crashPoint, history, isHash } from "./crash.js";
import { COUNTS, ANALYSIS_CSS, createAnalysisPanel } from "./analysis.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toFixed(2) + "×";
const tone = (x) => (x >= 10 ? "bg" : x >= 2 ? "hi" : "lo");
const MAX = COUNTS[COUNTS.length - 1];

document.head.append(Object.assign(document.createElement("style"), { textContent: ANALYSIS_CSS }));

let latest = null;
let crashes = []; // newest first
let computedFor = "";
const panel = createAnalysisPanel($("analysis"), () => crashes, { storageKey: "popup-analysis" });

const SOURCES = { dom: "round details box", json: "page data", loose: "page data", manual: "entered by hand" };
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString();
};

function showLatest() {
  $("empty").hidden = !!latest;
  $("latest").hidden = !latest;
  $("analysisCard").hidden = $("recentCard").hidden = !latest;
  if (!latest) return;
  $("roundId").textContent = latest.roundId ?? "unknown";
  $("crash").textContent = fmt(latest.crash);
  $("crash").className = "crash " + tone(latest.crash);
  $("hash").textContent = latest.hash;
  $("salt").textContent = latest.salt;
  $("status").innerHTML =
    (latest.verified ? `<span class="ok">✔ Chains onto the previous round</span>` : `<span class="warn">Not chain-checked yet</span>`) +
    ` · from ${SOURCES[latest.source] ?? latest.source} · ${ago(latest.seenAt)}`;
}

async function compute() {
  if (!latest) { crashes = []; panel.render(); return; }
  const key = latest.hash + latest.salt;
  if (key === computedFor) return;
  computedFor = key;
  // Show a quick result first, then fill in the rest.
  crashes = (await history(latest.hash, 2000, latest.roundId, latest.salt)).map((r) => r.crash);
  renderRecent();
  panel.render();
  const all = await history(latest.hash, MAX, latest.roundId, latest.salt);
  if (computedFor !== key) return;
  crashes = all.map((r) => r.crash);
  panel.render();
}

function renderRecent() {
  $("recent").innerHTML = crashes.slice(0, 20).map((x) => `<span class="${tone(x)}">${fmt(x)}</span>`).join("");
}

async function load() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  showLatest();
  await compute();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latest) load();
});

// ---- "Get latest round" ----

async function findBcTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && /^https:\/\/([a-z0-9-]+\.)*bc\.game\//i.test(active.url)) return active;
  const tabs = await chrome.tabs.query({ url: ["https://bc.game/*", "https://*.bc.game/*"] });
  return tabs.find((t) => /\/game\/crash/.test(t.url ?? "")) ?? tabs[0] ?? null;
}

async function askTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "getLatest" });
  } catch {
    // The tab was open before the extension was installed/reloaded: start it now.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, { type: "getLatest" });
  }
}

function setGetStatus(html, cls = "") {
  $("getStatus").className = "status " + cls;
  $("getStatus").innerHTML = html;
}

$("getLatest").onclick = async () => {
  const btn = $("getLatest");
  btn.disabled = true;
  btn.textContent = "Getting latest round…";
  setGetStatus("");
  try {
    const tab = await findBcTab();
    if (!tab) return setGetStatus("Open https://bc.game/game/crash in this window first.", "err");
    const res = await askTab(tab.id);
    if (!res?.ok) {
      const d = res?.debug ?? {};
      return setGetStatus(
        `${res?.error ?? "No answer from the bc.game tab. Reload the tab and try again."}\n` +
          `Details: page ${d.url ?? tab.url}, history items found ${d.historyItems ?? 0}, ` +
          `page-data hashes seen ${d.pageHashes ?? 0}${d.tried?.length ? `, tried: ${d.tried.join("; ")}` : ""}`,
        "err"
      );
    }
    const r = res.round;
    const salt = r.salt || latest?.salt || DEFAULT_SALT;
    const entry = { roundId: r.roundId, hash: r.hash, salt, crash: crashPoint(r.hash, salt), verified: false, source: "dom", seenAt: Date.now() };
    if (!latest || latest.roundId == null || r.roundId >= latest.roundId) {
      if (latest?.hash === r.hash) entry.verified = latest.verified;
      await chrome.storage.local.set({ latest: entry, salt });
    }
    const check = r.shownCrash != null && Math.abs(r.shownCrash - entry.crash) < 0.005 ? ` ✔ matches bc.game's ${fmt(r.shownCrash)}` : "";
    setGetStatus(`Got round ${r.roundId}: ${fmt(entry.crash)}${check}`, "ok");
  } catch (e) {
    setGetStatus(`Failed: ${e.message}. Reload the bc.game tab and try again.`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Get latest round";
  }
};

// ---- Other buttons ----

$("openFull").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("full.html") });

document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    await navigator.clipboard.writeText(latest[b.dataset.copy]);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1200);
  };
});

$("reset").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "reset" });
  latest = null;
  computedFor = "";
  crashes = [];
  showLatest();
};

$("mSave").onclick = async () => {
  const roundText = $("mRound").value.trim();
  const hash = $("mHash").value.trim().toLowerCase();
  const salt = $("mSalt").value.trim().toLowerCase() || latest?.salt || DEFAULT_SALT;
  if (!isHash(hash)) return ($("mError").textContent = "Hash must be 64 hex characters.");
  if (!isHash(salt)) return ($("mError").textContent = "Salt must be 64 hex characters.");
  if (roundText && !/^\d+$/.test(roundText)) return ($("mError").textContent = "Round ID must be a number.");
  $("mError").textContent = "";
  await chrome.storage.local.set({
    latest: { roundId: roundText ? Number(roundText) : null, hash, salt, crash: crashPoint(hash, salt), verified: false, source: "manual", seenAt: Date.now() },
    salt,
  });
};

load();
