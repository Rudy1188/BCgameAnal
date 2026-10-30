// The panel shown inside the bc.game crash page (loaded in an iframe by overlay.js).
import { DEFAULT_SALT, crashPoint, isHash } from "./crash.js";
import { MAX_COUNT, DEFAULT_COUNT, COUNTS, POINTS, analyze } from "./analysis.js";
import { TREND_CSS, createTrendPanel } from "./trend.js";
import { Chain } from "./chain.js";
import { updateFromTab } from "./latest.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
const num = (n) => n.toLocaleString();
const tone = (x, point = 2) => (x < point ? "lo" : x >= 10 ? "bg" : "hi");
const short = (n) => (n >= 1000 ? n / 1000 + "K" : String(n));

document.head.append(Object.assign(document.createElement("style"), { textContent: TREND_CSS }));

// Tell the page how tall the panel is, so the frame fits it.
const postHeight = () => parent.postMessage({ __bcTrendPanel: "height", h: document.querySelector("main").offsetHeight }, "*");
new ResizeObserver(postHeight).observe(document.querySelector("main"));

// ---- Settings (remembered) ----
let settings = { count: DEFAULT_COUNT, point: 2 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("trend-panel") || "{}")); } catch {}
const clampCount = (n) => Math.max(10, Math.min(MAX_COUNT, Math.round(n) || DEFAULT_COUNT));
settings.count = clampCount(settings.count);
if (!(settings.point > 1)) settings.point = 2;
const save = () => { try { localStorage.setItem("trend-panel", JSON.stringify(settings)); } catch {} };

// ---- Data: unconfirmed rounds from the page strip + the hash chain, newest first ----
let latest = null;
let pending = [];
const chain = new Chain();
let data = new Float64Array(0);
let progress = "";

const roundId = (i) => (chain.latest?.roundId != null ? chain.latest.roundId + pending.length - i : null);

function rebuild() {
  const base = chain.crashes, p = pending.length;
  const total = Math.min(settings.count, base.length + p);
  data = new Float64Array(total);
  for (let i = 0; i < total; i++) data[i] = i < p ? pending[p - 1 - i].c : base[i - p];
}

const trend = createTrendPanel($("trend"), { rows: 10, cell: 20 });

function render() {
  const { count, point } = settings;
  $("count").value = String(count);
  $("point").value = String(point);
  document.querySelectorAll(".pt-label").forEach((e) => (e.textContent = point + "×"));
  $("chips").innerHTML =
    COUNTS.map((c) => `<button data-c="${c}" class="${c === count ? "on" : ""}">${short(c)}</button>`).join("") +
    `<span class="sep"></span>` +
    POINTS.map((p) => `<button data-p="${p}" class="${p === point ? "on" : ""}">${p}×</button>`).join("");
  rebuild();
  const n = data.length;
  if (!n) {
    $("anBody").innerHTML = "";
    $("note").textContent = progress || "No rounds yet.";
  } else {
    $("anBody").innerHTML = analyze(data, n, point).sides.map((s) =>
      `<tr><td class="${s.cls}">${s.label}</td><td>${s.chance.toFixed(2)}%</td><td>${num(s.count)}</td><td>${s.maxCombo}</td></tr>`).join("");
    $("note").textContent = n < count ? progress || `Only ${num(n)} rounds calculated so far.` : "";
  }
  trend.render({ crashes: data, n, point, big: 10, roundId });
}

// ---- Controls ----
function setCount(c) {
  settings.count = clampCount(c);
  save();
  render();
  extend();
}
$("count").onchange = () => setCount(Number($("count").value));
$("point").onchange = () => {
  const v = Number($("point").value);
  if (v > 1) { settings.point = Math.round(v * 100) / 100; save(); }
  render();
};
$("chips").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.c) setCount(Number(b.dataset.c));
  if (b.dataset.p) { settings.point = Number(b.dataset.p); save(); render(); }
};

function extend() {
  if (!chain.latest) return;
  chain.extendTo(settings.count, (done, total) => {
    progress = done < total ? `Calculating ${num(done)} / ${num(total)}…` : "";
    $("note").textContent = progress;
  }).then(() => { progress = ""; render(); });
}

// ---- Latest round ----
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString();
};

function showLatest() {
  $("main").hidden = !latest;
  if (!latest) {
    $("roundLine").innerHTML = `<span class="empty">No round yet. Click <b>Refresh</b>.</span>`;
    return;
  }
  // The newest round may be an unconfirmed one read from the page strip.
  const p = pending.length;
  const newest = p ? pending[p - 1].c : latest.crash;
  $("roundLine").innerHTML = `<span class="muted">Round</span> <b>${latest.roundId != null ? latest.roundId + p : "?"}</b> ` +
    `<span class="crash ${tone(newest, settings.point)}">${fmt(newest)}</span>`;
}

let lastUpdate = 0;
async function load() {
  ({ latest = null, pending = [] } = await chrome.storage.local.get(["latest", "pending"]));
  chain.setLatest(latest);
  if (!latest) pending = [];
  showLatest();
  render();
  extend();
  lastUpdate = Date.now();
  setLive();
}

let loadQueued = false;
chrome.storage.onChanged.addListener((changes) => {
  if ((!changes.latest && !changes.pending) || loadQueued) return;
  loadQueued = true;
  setTimeout(() => { loadQueued = false; load(); }, 50);
});

function setLive() {
  const s = Math.round((Date.now() - lastUpdate) / 1000);
  $("live").className = "live" + (latest && s < 60 ? " on" : "");
  $("live").textContent = latest ? (s < 60 ? "● Live" : `updated ${ago(lastUpdate)}`) : "";
}
setInterval(setLive, 5000);

function setAutoStatus(message, cls = "") {
  $("autoStatus").className = "status " + cls;
  $("autoStatus").textContent = message;
}

async function autoUpdate() {
  setAutoStatus("Reading the latest round…");
  try {
    const res = await updateFromTab(latest);
    setAutoStatus(res.ok ? "" : res.message, res.cls);
  } catch (e) {
    setAutoStatus(`Couldn't update: ${e.message}`, "err");
  }
}
$("refresh").onclick = autoUpdate;

$("reset").onclick = async () => {
  if (confirm("Forget the saved round and history?")) await chrome.runtime.sendMessage({ type: "reset" });
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
    pending: [],
  });
};

await load();
// Clicking bc.game's round box on every page load would be distracting: only do it
// when nothing is saved yet or the saved round is old. New rounds arrive on their own.
if (!latest || Date.now() - latest.seenAt > 10 * 60 * 1000) autoUpdate();
