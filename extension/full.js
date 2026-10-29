import { COUNTS_FULL, POINTS, ANALYSIS_CSS, analyze, createAnalysisPanel } from "./analysis.js";
import { TREND_CSS, createTrendPanel } from "./trend.js";
import { Chain } from "./chain.js";
import { previousHash } from "./crash.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toFixed(2) + "×";
const tone = (x) => (x >= 10 ? "bg" : x >= 2 ? "hi" : "lo");
const PAGE = 100;
const CSV_LIMIT = 200000; // hashes are rebuilt per row, so keep downloads reasonable

document.head.append(Object.assign(document.createElement("style"), { textContent: ANALYSIS_CSS + TREND_CSS }));

let latest = null;
let page = 0;
let selected = -1;
const chain = new Chain();

const panel = createAnalysisPanel($("analysis"), () => chain.crashes, {
  counts: COUNTS_FULL,
  storageKey: "full-analysis",
  onChange: ({ count }) => { renderAll(); extend(count); },
});
const trend = createTrendPanel($("trend"), {
  getCrashes: () => chain.crashes,
  getRoundId: (i) => chain.roundIdAt(i),
  getPoint: () => panel.point,
  getCount: () => panel.count,
  height: 220,
  cell: 18,
});

function extend(count) {
  chain.extendTo(count, (done, total) => {
    const text = done < total ? `Calculating ${done.toLocaleString()} / ${total.toLocaleString()} rounds…` : "";
    $("progress").textContent = text;
    panel.setProgress(text);
  }).then(() => {
    $("progress").textContent = "";
    panel.setProgress("");
    renderAll();
  });
}

function renderOverview() {
  const crashes = chain.crashes;
  if (!crashes.length) { $("overview").innerHTML = ""; return; }
  const n = Math.min(panel.count, crashes.length);
  $("ovTitle").textContent = `(last ${n.toLocaleString()} rounds)`;
  $("overview").innerHTML = POINTS.map((p) => {
    const [lo, hi] = analyze(crashes, n, p).sides;
    return `<tr><td><b>${p}×</b></td><td class="lo">${lo.chance.toFixed(2)}% <span class="muted">(${lo.count.toLocaleString()})</span></td>` +
      `<td class="hi">${hi.chance.toFixed(2)}% <span class="muted">(${hi.count.toLocaleString()})</span></td><td>${lo.maxCombo}</td><td>${hi.maxCombo}</td></tr>`;
  }).join("");
}

function renderLatest() {
  $("emptyCard").hidden = !!latest;
  for (const id of ["latestCard", "trendCard", "cols", "historyCard"]) $(id).hidden = !latest;
  if (!latest) return;
  $("roundId").textContent = latest.roundId ?? "unknown";
  $("crash").textContent = fmt(latest.crash);
  $("crash").className = "crash " + tone(latest.crash);
  $("hash").textContent = latest.hash;
}

function renderPage() {
  const total = chain.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const start = page * PAGE;
  $("pageInfo").textContent = `Page ${(page + 1).toLocaleString()} of ${pages.toLocaleString()} · ${total.toLocaleString()} rounds`;
  const crashes = chain.crashes;
  let h = total ? chain.hashAt(start) : null;
  const rows = [];
  for (let i = start; i < Math.min(start + PAGE, total); i++) {
    const r = chain.roundIdAt(i);
    rows.push(`<tr class="${i === selected ? "sel" : ""}"><td class="muted">${(i + 1).toLocaleString()}</td><td>${r ?? ""}</td>` +
      `<td class="x ${tone(crashes[i])}">${fmt(crashes[i])}</td><td class="h">${h}</td></tr>`);
    h = previousHash(h);
  }
  $("rows").innerHTML = rows.join("");
}

function renderAll() {
  panel.render();
  renderOverview();
  trend.render();
  renderPage();
}

async function load() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  renderLatest();
  chain.setLatest(latest);
  renderAll();
  if (latest) extend(panel.count);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latest) load();
});

$("first").onclick = () => { page = 0; renderPage(); };
$("prev").onclick = () => { page--; renderPage(); };
$("next").onclick = () => { page++; renderPage(); };
$("last").onclick = () => { page = Infinity; renderPage(); };

$("find").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  const id = Number($("find").value.trim());
  $("findStatus").textContent = "";
  if (chain.latest?.roundId == null || !Number.isInteger(id)) return;
  const i = chain.latest.roundId - id;
  if (i < 0) { $("findStatus").textContent = "That round is newer than the latest saved round."; return; }
  if (i >= chain.length) {
    $("findStatus").textContent = `Round ${id} is ${(i + 1).toLocaleString()} rounds back. Pick a larger "Last … rounds" in Analysis to calculate that far.`;
    return;
  }
  selected = i;
  page = Math.floor(i / PAGE);
  renderPage();
};

$("csv").onclick = () => {
  const n = Math.min(chain.length, Math.max(panel.count, 1), CSV_LIMIT);
  const crashes = chain.crashes;
  const lines = ["round,crash,hash"];
  let h = chain.hashAt(0);
  for (let i = 0; i < n; i++) {
    lines.push(`${chain.roundIdAt(i) ?? ""},${crashes[i]},${h}`);
    h = previousHash(h);
  }
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })),
    download: `crash-rounds-${latest?.roundId ?? "latest"}-${n}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

load();
