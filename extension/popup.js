import { DEFAULT_SALT, crashPoint, history, isHash } from "./crash.js";

const $ = (id) => document.getElementById(id);
const fmt = (x) => x.toFixed(2) + "×";
const tone = (x) => (x >= 10 ? "bg" : x >= 2 ? "hi" : "lo");
let latest = null;
let rounds = [];

const SOURCES = { dom: "round details box", json: "page data", loose: "page data", manual: "entered by hand" };

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString();
}

function showLatest() {
  $("empty").hidden = !!latest;
  $("latest").hidden = !latest;
  $("historyCard").hidden = !latest;
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

async function calculate() {
  if (!latest) return;
  const count = Math.min(5000, Math.max(1, Number($("count").value) || 100));
  rounds = await history(latest.hash, count, latest.roundId, latest.salt);
  const xs = rounds.map((r) => r.crash);
  const sorted = [...xs].sort((a, b) => a - b);
  const pct = (n) => ((100 * n) / xs.length).toFixed(1) + "%";
  $("stats").innerHTML = [
    ["Median", fmt(sorted[Math.floor(sorted.length / 2)]), ""],
    ["Below 2×", pct(xs.filter((x) => x < 2).length), "lo"],
    ["2× and up", pct(xs.filter((x) => x >= 2).length), "hi"],
    ["10× and up", pct(xs.filter((x) => x >= 10).length), "bg"],
  ].map(([k, v, c]) => `<div class="stat"><b class="${c}">${v}</b><span>${k}</span></div>`).join("");
  $("rows").innerHTML = rounds
    .map((r) => `<tr><td>${r.roundId ?? ""}</td><td class="x ${tone(r.crash)}">${fmt(r.crash)}</td><td class="h">${r.hash.slice(0, 20)}…</td></tr>`)
    .join("");
}

async function load() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  showLatest();
  await calculate();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latest) load();
});

$("calc").onclick = calculate;
$("count").onkeydown = (e) => e.key === "Enter" && calculate();

document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    await navigator.clipboard.writeText(latest[b.dataset.copy]);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1200);
  };
});

$("csv").onclick = () => {
  const csv = "round,crash,hash\n" + rounds.map((r) => `${r.roundId ?? ""},${r.crash},${r.hash}`).join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: `crash-rounds-${latest?.roundId ?? "latest"}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("reset").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "reset" });
  latest = null;
  rounds = [];
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
  const entry = {
    roundId: roundText ? Number(roundText) : null,
    hash,
    salt,
    crash: await crashPoint(hash, salt),
    verified: false,
    source: "manual",
    seenAt: Date.now(),
  };
  await chrome.storage.local.set({ latest: entry, salt });
};

load();
