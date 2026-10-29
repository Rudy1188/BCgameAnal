import { DEFAULT_SALT, crashPoint, isHash } from "./crash.js";
import { COUNTS_POPUP, ANALYSIS_CSS, createAnalysisPanel } from "./analysis.js";
import { TREND_CSS, createTrendPanel } from "./trend.js";
import { Chain } from "./chain.js";
import { updateFromTab } from "./latest.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toFixed(2) + "×";
const tone = (x) => (x >= 10 ? "bg" : x >= 2 ? "hi" : "lo");

document.head.append(Object.assign(document.createElement("style"), { textContent: ANALYSIS_CSS + TREND_CSS }));

let latest = null;
const chain = new Chain();

const panel = createAnalysisPanel($("analysis"), () => chain.crashes, {
  counts: COUNTS_POPUP,
  storageKey: "popup-analysis",
  onChange: ({ count }) => { trend.render(); extend(count); },
});
const trend = createTrendPanel($("trend"), {
  getCrashes: () => chain.crashes,
  getRoundId: (i) => chain.roundIdAt(i),
  getPoint: () => panel.point,
  getCount: () => panel.count,
  height: 110,
  cell: 16,
});

function extend(count) {
  chain.extendTo(count, (done, total) => panel.setProgress(done < total ? `Calculating ${done.toLocaleString()} / ${total.toLocaleString()}…` : ""))
    .then(() => { panel.setProgress(""); trend.render(); });
}

const SOURCES = { dom: "round details box", json: "page data", loose: "page data", manual: "entered by hand" };
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString();
};

function showLatest() {
  $("empty").hidden = !!latest;
  $("latest").hidden = !latest;
  $("trendCard").hidden = $("analysisCard").hidden = !latest;
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

async function load() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  showLatest();
  chain.setLatest(latest);
  panel.render();
  trend.render();
  if (latest) extend(panel.count);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latest) load();
});

function setAutoStatus(message, cls = "") {
  $("autoStatus").className = "status " + cls;
  $("autoStatus").textContent = message;
}

// Fetch the newest round from the bc.game tab every time the popup opens.
async function autoUpdate() {
  setAutoStatus("Checking bc.game tab for the latest round…");
  try {
    const res = await updateFromTab(latest);
    setAutoStatus(res.message, res.cls);
  } catch (e) {
    setAutoStatus(`Couldn't update: ${e.message}`, "err");
  }
}

$("openFull").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("full.html") });
$("openStrategy").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("strategy.html") });
$("openReport").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });

document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    await navigator.clipboard.writeText(latest[b.dataset.copy]);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1200);
  };
});

$("reset").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "reset" });
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

await load();
autoUpdate();
