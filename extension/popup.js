import { DEFAULT_SALT, crashPoint, isHash } from "./crash.js";
import { MAX_COUNT, DEFAULT_COUNT, COUNTS, POINTS, analyze, biggest } from "./analysis.js";
import { TREND_CSS, createTrendPanel } from "./trend.js";
import { Chain } from "./chain.js";
import { updateFromTab } from "./latest.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
const num = (n) => n.toLocaleString();
const tone = (x, point = 2) => (x < point ? "lo" : x >= 10 ? "bg" : "hi");
const short = (n) => (n >= 1000 ? n / 1000 + "K" : String(n));

document.head.append(Object.assign(document.createElement("style"), { textContent: TREND_CSS }));

// ---- Settings (remembered per browser) ----
let settings = { count: DEFAULT_COUNT, point: 2 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("trend-window") || "{}")); } catch {}
const clampCount = (n) => Math.max(10, Math.min(MAX_COUNT, Math.round(n) || DEFAULT_COUNT));
settings.count = clampCount(settings.count);
if (!(settings.point > 1)) settings.point = 2;
const save = () => { try { localStorage.setItem("trend-window", JSON.stringify(settings)); } catch {} };

// ---- Data: unconfirmed rounds from the page strip + the hash chain, newest first ----
let latest = null;
let pending = [];
const chain = new Chain();
let data = new Float64Array(0);
let progress = "";
let pickId = null; // round highlighted from the biggest list (round ID, or "#index" if unknown)

const roundId = (i) => (chain.latest?.roundId != null ? chain.latest.roundId + pending.length - i : null);
const setPick = (i) => { pickId = roundId(i) ?? "#" + i; };
const pickIndex = () => (pickId == null ? -1 : typeof pickId === "string" ? Number(pickId.slice(1)) : roundId(0) - pickId);

function rebuild() {
  const base = chain.crashes, p = pending.length;
  const total = Math.min(settings.count, base.length + p);
  data = new Float64Array(total);
  for (let i = 0; i < total; i++) data[i] = i < p ? pending[p - 1 - i].c : base[i - p];
}

const trend = createTrendPanel($("trend"), {
  onPick: (i) => { setPick(i); render(); },
});

// ---- Rendering ----
function renderChips() {
  $("chips").innerHTML =
    COUNTS.map((c) => `<button data-c="${c}" class="${c === settings.count ? "on" : ""}">${short(c)}</button>`).join("") +
    `<span class="sep"></span>` +
    POINTS.map((p) => `<button data-p="${p}" class="${p === settings.point ? "on" : ""}">${p}×</button>`).join("");
}

function render() {
  const { count, point } = settings;
  $("count").value = String(count);
  $("point").value = String(point);
  document.querySelectorAll(".pt-label").forEach((e) => (e.textContent = point + "×"));
  renderChips();
  rebuild();
  const n = data.length;

  // Table
  if (!n) {
    $("anBody").innerHTML = "";
    $("note").textContent = progress || "No rounds yet.";
  } else {
    const { sides } = analyze(data, n, point);
    $("anBody").innerHTML = sides.map((s) =>
      `<tr><td class="${s.cls}">${s.label}</td><td>${s.chance.toFixed(2)}%</td><td>${num(s.count)}</td><td>${s.maxCombo}</td></tr>`).join("");
    $("note").textContent = n < count ? progress || `Only ${num(n)} rounds calculated so far.` : "";
  }

  // Biggest
  const top = biggest(data, n, 10);
  const marks = new Map();
  if (top.length) marks.set(top[0].i, "max");
  const pick = pickIndex();
  if (pick >= 0 && pick < n) marks.set(pick, "pick");
  $("bigRange").textContent = n ? `· last ${num(n)} rounds` : "";
  if (top.length) {
    const b = top[0];
    $("best").innerHTML = `<div class="best" data-i="${b.i}" title="Show in trend">
      <div class="x">${fmt(b.x)}</div>
      <div class="meta">Round <b>${roundId(b.i) ?? "#" + (b.i + 1)}</b><br>${b.i === 0 ? "latest round" : num(b.i) + " rounds ago"}</div></div>`;
    const lmax = Math.log(top[0].x) || 1;
    $("tops").innerHTML = top.slice(1).map((t, k) => `<div class="r" data-i="${t.i}" title="Show in trend">
      <span class="n">${k + 2}</span><span class="id">${roundId(t.i) ?? "#" + (t.i + 1)}</span>
      <span><span class="bar" style="display:block;width:${Math.max(2, (100 * Math.log(t.x)) / lmax)}%"></span></span>
      <span class="v ${tone(t.x, point)}">${fmt(t.x)}</span></div>`).join("");
  } else {
    $("best").innerHTML = $("tops").innerHTML = "";
  }

  trend.render({ crashes: data, n, point, big: 10, roundId, marks });
  renderHistory();
}

// History list, newest first, paged
const PER_PAGE = 60;
let histPage = 0;
function renderHistory() {
  const n = data.length, point = settings.point;
  const pages = Math.max(1, Math.ceil(n / PER_PAGE));
  histPage = Math.max(0, Math.min(histPage, pages - 1));
  const from = histPage * PER_PAGE, to = Math.min(n, from + PER_PAGE);
  let html = "";
  for (let i = from; i < to; i++) {
    html += `<div><span class="id">${roundId(i) ?? "#" + (i + 1)}</span><b class="${tone(data[i], point)}">${data[i] >= 100 ? data[i].toFixed(0) : +data[i].toFixed(2)}×</b></div>`;
  }
  $("hist").innerHTML = html;
  $("histPage").textContent = `${num(histPage + 1)} / ${num(pages)}`;
  $("histPager").querySelector('[data-h="first"]').disabled = $("histPager").querySelector('[data-h="prev"]').disabled = histPage === 0;
  $("histPager").querySelector('[data-h="last"]').disabled = $("histPager").querySelector('[data-h="next"]').disabled = histPage >= pages - 1;
}
$("histPager").querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => {
  const h = b.dataset.h;
  histPage = h === "first" ? 0 : h === "last" ? Infinity : h === "prev" ? histPage - 1 : histPage + 1;
  renderHistory();
}));

// Clicking the biggest crash (or a top-10 row) jumps to it in the trend
for (const id of ["best", "tops"]) {
  $(id).onclick = (e) => {
    const i = Number(e.target.closest("[data-i]")?.dataset.i);
    if (!Number.isInteger(i)) return;
    setPick(i);
    render();
    trend.focus(i);
    $("trend").scrollIntoView({ behavior: "smooth", block: "center" });
  };
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
const SOURCES = { dom: "round details box", json: "page data", loose: "page data", manual: "entered by hand" };
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString();
};

function showLatest() {
  $("empty").hidden = !!latest;
  $("latest").hidden = $("main").hidden = !latest;
  if (!latest) return;
  // The newest round may be an unconfirmed one read from the page strip.
  const p = pending.length;
  const newest = p ? pending[p - 1].c : latest.crash;
  $("roundId").textContent = latest.roundId != null ? latest.roundId + p : "unknown";
  $("crash").textContent = fmt(newest);
  $("crash").className = "crash " + tone(newest, settings.point);
  $("hash").textContent = latest.hash;
  $("salt").textContent = latest.salt;
  $("status").innerHTML =
    (latest.verified ? `<span class="ok">✔ Chains onto the previous round</span>` : `<span class="warn">Not chain-checked yet</span>`) +
    ` · round ${latest.roundId ?? "?"} from ${SOURCES[latest.source] ?? latest.source} · ${ago(latest.seenAt)}` +
    (p ? `\n${p} newer round${p > 1 ? "s" : ""} read from the page, confirmed when the next hash is read.` : "");
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
  if (!changes.latest && !changes.pending) return;
  if (loadQueued) return;
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
  setAutoStatus("Checking bc.game tab for the latest round…");
  try {
    const res = await updateFromTab(latest);
    setAutoStatus(res.ok ? "" : res.message, res.cls);
    if (res.ok) { $("status").title = res.message; }
  } catch (e) {
    setAutoStatus(`Couldn't update: ${e.message}`, "err");
  }
}
$("refresh").onclick = autoUpdate;

document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    await navigator.clipboard.writeText(latest[b.dataset.copy]);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1200);
  };
});

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
autoUpdate();
