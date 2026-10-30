// The panel shown inside the bc.game crash page (loaded in an iframe by overlay.js).
import { MAX_COUNT, DEFAULT_COUNT, COUNTS, POINTS, analyze } from "./analysis.js";
import { TREND_CSS, createTrendPanel } from "./trend.js";
import { Chain } from "./chain.js";
import { updateFromTab } from "./latest.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
const num = (n) => n.toLocaleString();
const tone = (x) => (x <= 1 ? "bust" : x < 2 ? "lo" : x >= 100 ? "huge" : x >= 10 ? "bg" : "hi");
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

// ---- Trend look (Settings): board size, ball size and colours, saved in chrome.storage ----
const STYLE_DEFAULT = { rows: 10, cols: 30, cell: 18, dot: 60,
  colors: { bust: "#f0443b", low: "#ffad4d", high: "#24ee89", big: "#ebf005", huge: "#ffffff", cell: "#1f2226", layer: "#2b2f33" } };
const COLOR_INPUTS = { bust: "cBust", low: "cLow", high: "cHigh", big: "cBig", huge: "cHuge", cell: "cCell", layer: "cLayer" };
let look = structuredClone(STYLE_DEFAULT);
const clampInt = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);

function makeTrend() {
  const gap = Math.max(1, Math.round(look.cell / 9));
  return createTrendPanel($("trend"), { rows: look.rows, cols: look.cols, cell: look.cell, gap, dot: look.dot / 100 });
}

function applyLook(rebuildBoard) {
  for (const [k, v] of Object.entries(look.colors)) document.documentElement.style.setProperty("--" + k, v);
  $("sRows").value = look.rows; $("sCols").value = look.cols;
  $("sCell").value = look.cell; $("oCell").textContent = look.cell + "px";
  $("sDot").value = look.dot; $("oDot").textContent = look.dot + "%";
  for (const [k, id] of Object.entries(COLOR_INPUTS)) $(id).value = look.colors[k];
  if (rebuildBoard) trend = makeTrend();
  render();
}

// Width the panel needs to show the whole board (board + paddings + borders).
const fitWidth = () => {
  const gap = Math.max(1, Math.round(look.cell / 9));
  parent.postMessage({ __bcTrendPanel: "fitWidth", w: Math.max(420, look.cols * (look.cell + gap) - gap + 44) }, "*");
};

let saveTimer = 0;
function changeLook(mutate, { board = false } = {}) {
  mutate(look);
  look.rows = clampInt(look.rows, 4, 20, 10);
  look.cols = clampInt(look.cols, 10, 60, 30);
  look.cell = clampInt(look.cell, 10, 30, 18);
  look.dot = clampInt(look.dot, 30, 100, 60);
  applyLook(board);
  if (board) fitWidth();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ trendStyle: look }), 300);
}

$("gear").onclick = () => { $("settings").hidden = !$("settings").hidden; $("gear").classList.toggle("on", !$("settings").hidden); };
$("sRows").onchange = () => changeLook((l) => (l.rows = $("sRows").value), { board: true });
$("sCols").onchange = () => changeLook((l) => (l.cols = $("sCols").value), { board: true });
$("sCell").oninput = () => changeLook((l) => (l.cell = $("sCell").value), { board: true });
$("sDot").oninput = () => changeLook((l) => (l.dot = $("sDot").value), { board: true });
for (const [k, id] of Object.entries(COLOR_INPUTS)) $(id).oninput = () => changeLook((l) => (l.colors[k] = $(id).value));
$("setDefault").onclick = () => changeLook((l) => Object.assign(l, structuredClone(STYLE_DEFAULT)), { board: true });

let trend = makeTrend();

function render() {
  const { count, point } = settings;
  $("count").value = String(count);
  $("point").value = String(point);
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
  // The trend always uses 2× (like bc.game), whatever payout the table uses.
  trend.render({ crashes: data, n, point: 2, big: 10, roundId });
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
    `<span class="crash ${tone(newest)}">${fmt(newest)}</span>`;
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

{
  const { trendStyle } = await chrome.storage.local.get("trendStyle");
  if (trendStyle) look = { ...structuredClone(STYLE_DEFAULT), ...trendStyle, colors: { ...STYLE_DEFAULT.colors, ...trendStyle.colors } };
  applyLook(true);
}
await load();
// Clicking bc.game's round box on every page load would be distracting: only do it
// when nothing is saved yet or the saved round is old. New rounds arrive on their own.
if (!latest || Date.now() - latest.seenAt > 10 * 60 * 1000) autoUpdate();
