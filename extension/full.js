import { history } from "./crash.js";
import { COUNTS, POINTS, ANALYSIS_CSS, analyze, createAnalysisPanel } from "./analysis.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toFixed(2) + "×";
const tone = (x) => (x >= 10 ? "bg" : x >= 2 ? "hi" : "lo");
const MAX = COUNTS[COUNTS.length - 1];
const PAGE = 100;

document.head.append(Object.assign(document.createElement("style"), { textContent: ANALYSIS_CSS }));

let latest = null;
let rounds = []; // newest first
let crashes = [];
let page = 0;
let selected = -1;
let computedFor = "";

const panel = createAnalysisPanel($("analysis"), () => crashes, {
  storageKey: "full-analysis",
  onChange: ({ count }) => renderOverview(count),
});

function renderOverview(count) {
  if (!crashes.length) return;
  const n = Math.min(count, crashes.length);
  $("ovTitle").textContent = `(last ${n.toLocaleString()} rounds)`;
  $("overview").innerHTML = POINTS.map((p) => {
    const [lo, hi] = analyze(crashes, count, p).sides;
    return `<tr><td><b>${p}×</b></td><td class="lo">${lo.chance.toFixed(2)}% <span class="muted">(${lo.count.toLocaleString()})</span></td>` +
      `<td class="hi">${hi.chance.toFixed(2)}% <span class="muted">(${hi.count.toLocaleString()})</span></td><td>${lo.maxCombo}</td><td>${hi.maxCombo}</td></tr>`;
  }).join("");
}

function renderLatest() {
  $("emptyCard").hidden = !!latest;
  for (const id of ["latestCard", "cols", "historyCard"]) $(id).hidden = !latest;
  if (!latest) return;
  $("roundId").textContent = latest.roundId ?? "unknown";
  $("crash").textContent = fmt(latest.crash);
  $("crash").className = "crash " + tone(latest.crash);
  $("hash").textContent = latest.hash;
}

function renderStrip() {
  const recent = crashes.slice(0, 300).reverse();
  if (!recent.length) return ($("strip").innerHTML = "");
  const max = Math.log(Math.max(...recent) + 1);
  $("strip").innerHTML = recent.map((x) => {
    const color = x >= 10 ? "var(--big)" : x >= 2 ? "var(--high)" : "var(--low)";
    return `<div style="height:${Math.max(4, (100 * Math.log(x + 1)) / max)}%;background:${color}" title="${fmt(x)}"></div>`;
  }).join("");
}

function renderPage() {
  const pages = Math.max(1, Math.ceil(rounds.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const start = page * PAGE;
  $("pageInfo").textContent = `Page ${page + 1} of ${pages.toLocaleString()} · ${rounds.length.toLocaleString()} rounds`;
  $("rows").innerHTML = rounds.slice(start, start + PAGE).map((r, i) =>
    `<tr class="${start + i === selected ? "sel" : ""}"><td class="muted">${(start + i + 1).toLocaleString()}</td><td>${r.roundId ?? ""}</td>` +
    `<td class="x ${tone(r.crash)}">${fmt(r.crash)}</td><td class="h">${r.hash}</td></tr>`
  ).join("");
}

async function compute() {
  if (!latest) return;
  const key = latest.hash + latest.salt;
  if (key === computedFor) return;
  computedFor = key;
  $("progress").textContent = "Calculating…";
  const result = await history(latest.hash, MAX, latest.roundId, latest.salt, (done, total) => {
    $("progress").textContent = `Calculating ${done.toLocaleString()} / ${total.toLocaleString()}…`;
  });
  if (computedFor !== key) return;
  rounds = result;
  crashes = rounds.map((r) => r.crash);
  $("progress").textContent = "";
  renderStrip();
  panel.render(); // also re-renders the overview
  renderPage();
}

async function load() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  renderLatest();
  await compute();
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
  const i = rounds.findIndex((r) => r.roundId === id);
  if (i === -1) { $("find").value = ""; $("find").placeholder = "Not in range"; return; }
  selected = i;
  page = Math.floor(i / PAGE);
  renderPage();
};

$("csv").onclick = () => {
  const csv = "round,crash,hash\n" + rounds.map((r) => `${r.roundId ?? ""},${r.crash},${r.hash}`).join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: `crash-rounds-${latest?.roundId ?? "latest"}-${rounds.length}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

load();
