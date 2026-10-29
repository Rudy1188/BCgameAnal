import { Chain } from "./chain.js";
import { drawChart } from "./charts.js";
import { RULES, points, backtest } from "./backtest.js";

const $ = (id) => document.getElementById(id);
const num = (x) => Math.round(x).toLocaleString();
const pct = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const C = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const chain = new Chain();
const worker = new Worker(new URL("./backtestworker.js", import.meta.url), { type: "module" });
let lastResult = null; // { rule, staking, opts, result, rounds }

// ---- Form ----
$("rule").innerHTML = Object.entries(RULES).map(([k, r]) => `<option value="${k}">${r.name}</option>`).join("");
function fillPoints() {
  const keep = $("point").value || "2";
  $("point").innerHTML = points(Number($("bustPay").value) || 49.99).map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  $("point").value = keep;
}
fillPoints();
$("bustPay").addEventListener("change", fillPoints);

function showParams() {
  const ps = RULES[$("rule").value].params;
  $("pPoint").hidden = !ps.includes("point");
  $("pN").hidden = !ps.includes("n");
  $("pY").hidden = !ps.includes("y");
  $("pWindow").hidden = !ps.includes("window");
  $("pFactor").hidden = $("pSteps").hidden = $("staking").value !== "martingale";
}
$("rule").onchange = showParams;
$("staking").onchange = showParams;
showParams();

// Remember the form.
const FIELDS = ["rule", "point", "n", "y", "window", "staking", "base", "factor", "steps", "bankroll", "rounds", "bustPay"];
try {
  const saved = JSON.parse(localStorage.getItem("strategy-form") || "{}");
  for (const f of FIELDS) if (saved[f] != null) $(f).value = saved[f];
  fillPoints(); if (saved.point) $("point").value = saved.point;
  showParams();
} catch {}
const saveForm = () => { try { localStorage.setItem("strategy-form", JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, $(f).value])))); } catch {} };

const readRule = () => ({ type: $("rule").value, point: $("point").value, n: Number($("n").value) || 1, y: Number($("y").value) || 1.01, window: Number($("window").value) || 2000 });
const readStaking = () => ({
  type: $("staking").value, base: Number($("base").value) || 1, factor: Number($("factor").value) || 2,
  maxSteps: Number($("steps").value) || 10, bankroll: Number($("bankroll").value) || 0,
});
const readOpts = () => ({ bustPayout: Number($("bustPay").value) || 49.99 });

function describe(rule) {
  const pt = points(readOpts().bustPayout).find((p) => p.id === rule.point)?.label ?? rule.point;
  return RULES[rule.type].name.replace("a point", pt).replace("N losses", `${rule.n} losses`).replace("below Y", `below ${rule.y}×`).replace("above Y", `above ${rule.y}×`).replace("W rounds", `${(rule.window || 2000).toLocaleString()} rounds`);
}

// ---- Data: newest rounds (hash chain + unconfirmed page rounds), oldest first ----
async function loadRounds(n) {
  const { latest = null, pending = [] } = await chrome.storage.local.get(["latest", "pending"]);
  if (!latest) throw new Error("No round saved yet. Open bc.game/game/crash, then click the extension icon.");
  chain.setLatest(latest);
  if (chain.length < n) await chain.extendTo(n, (d, t) => ($("progress").textContent = `Calculating rounds: ${num(d)} / ${num(t)}…`));
  const base = chain.crashes, p = pending.length;
  const total = Math.min(n, base.length + p);
  const out = new Float64Array(total);
  for (let i = 0; i < total; i++) { const j = total - 1 - i; out[i] = j < p ? pending[p - 1 - j].c : base[j - p]; }
  const round = chain.latest?.roundId != null ? chain.latest.roundId + p : null;
  return { crashes: out, round };
}

function ask(msg, transfer) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.progress) $("progress").textContent = data.progress;
      if (data.error) reject(new Error(data.error));
      if (data.done) resolve(data);
    };
    worker.postMessage(msg, transfer);
  });
}

const luck = (r) => (r.returnPct < r.rangePct[0] ? "bad" : r.returnPct > r.rangePct[1] ? "good" : "luck");
const verdictText = (r) =>
  luck(r) === "luck" ? `Inside the luck range: this is what chance alone gives in a fair game.`
  : luck(r) === "good" ? (r.returnPct < 0
      ? `Lost a little less than expected, but still a loss. With many rules tested, one landing just outside the luck range is normal.`
      : `Above the luck range. With many rules tested, one landing here by chance is expected; re-test on different rounds before trusting it.`)
  : `Below the luck range: this rule did worse than chance would explain (often from the stake plan or the payout setting).`;

// ---- Run one rule ----
async function runRule() {
  saveForm();
  const rule = readRule(), staking = readStaking(), opts = readOpts();
  $("run").disabled = $("compare").disabled = true;
  try {
    const { crashes, round } = await loadRounds(Number($("rounds").value));
    const { result } = await ask({ cmd: "run", crashes, rule, staking, opts }, [crashes.buffer]);
    lastResult = { rule, staking, opts, result, rounds: result.rounds };
    $("progress").textContent = `Tested on ${num(result.rounds)} rounds${round != null ? ` up to round ${round}` : ""}.`;
    renderResult(result, rule, staking);
    await refreshPick();
  } catch (e) {
    $("progress").textContent = "Failed: " + e.message;
  } finally {
    $("run").disabled = $("compare").disabled = false;
  }
}

function renderResult(r, rule, staking) {
  $("resultCard").hidden = false;
  $("resultTitle").textContent = describe(rule) + (staking.type === "martingale" ? ` · martingale ×${staking.factor}, max ${staking.maxSteps} steps` : " · flat stake");
  const cls = luck(r) === "luck" ? "warn" : luck(r);
  $("verdict").innerHTML = `<b class="${cls}">Return ${pct(r.returnPct)}</b> on ${num(r.bets)} bets. Luck range for a fair game: ${pct(r.rangePct[0])} to ${pct(r.rangePct[1])} (expected ${pct(r.expectedPct)}). ${verdictText(r)}` +
    (r.busted ? ` <b class="bad">Bankroll ran out after ${num(r.bets)} bets.</b>` : "");
  $("stats").innerHTML = [
    ["Bets", num(r.bets)], ["Wins", `${num(r.wins)} (${(100 * r.hitRate).toFixed(2)}%)`], ["Total staked", num(r.staked)],
    ["Profit", `<span class="${r.profit >= 0 ? "good" : "bad"}">${r.profit >= 0 ? "+" : ""}${num(r.profit)}</span>`],
    ["Biggest drop (drawdown)", num(r.maxDrawdown)], ["Longest losing streak", num(r.longestLoss)], ["Biggest single stake", num(r.maxStake)],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
  const ys = r.curve.map((p) => p[1]);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), pad = (hi - lo) * 0.1 || 1;
  drawChart($("curve"), {
    height: 220, x: [r.curve[0][0], r.curve[r.curve.length - 1][0]], y: [lo - pad, hi + pad],
    xFormat: (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(Math.round(v))), yFormat: (v) => num(v), xLabel: "rounds",
    layers: [{ type: "hline", y: 0, color: C("--muted"), width: 1 }, { type: "line", points: r.curve, color: r.profit >= 0 ? C("--high") : C("--low"), width: 1.5 }],
  });
  $("perPoint").innerHTML = r.perPoint.slice(0, 28).map((p) =>
    `<tr><td>${p.label}</td><td>${num(p.bets)}</td><td class="${p.profit >= 0 ? "good" : "bad"}">${p.profit >= 0 ? "+" : ""}${num(p.profit)}</td><td>${pct((100 * p.profit) / p.staked)}</td></tr>`).join("");
}

// ---- Compare all presets ----
async function compareAll() {
  saveForm();
  $("run").disabled = $("compare").disabled = true;
  try {
    const { crashes } = await loadRounds(Number($("rounds").value));
    const { rows } = await ask({ cmd: "compare", crashes, staking: readStaking(), opts: readOpts() }, [crashes.buffer]);
    $("progress").textContent = `Compared ${rows.length} rules on ${num(crashes.length)} rounds.`;
    $("compareCard").hidden = false;
    $("compareRows").innerHTML = rows.map((r, i) => {
      const l = luck(r);
      return `<tr class="clickable" data-i="${i}"><td>${r.label}</td><td>${num(r.bets)}</td><td class="${r.returnPct >= 0 ? "good" : "bad"}">${pct(r.returnPct)}</td>
        <td>${pct(r.rangePct[0])} to ${pct(r.rangePct[1])}</td><td class="${l === "luck" ? "warn" : l}">${l === "luck" ? "chance" : l === "good" ? (r.returnPct < 0 ? "lost less than expected (still a loss)" : "above chance — re-test") : "below chance"}${r.busted ? " · bust" : ""}</td>
        <td>${num(r.longestLoss)}</td><td>${r.next?.point ?? "skip"}</td></tr>`;
    }).join("");
    $("compareRows").querySelectorAll("tr").forEach((tr) => (tr.onclick = () => {
      const r = rows[Number(tr.dataset.i)].rule;
      $("rule").value = r.type; if (r.point) $("point").value = r.point; if (r.n) $("n").value = r.n; if (r.y) $("y").value = r.y; if (r.window) $("window").value = r.window;
      showParams(); runRule();
    }));
  } catch (e) {
    $("progress").textContent = "Failed: " + e.message;
  } finally {
    $("run").disabled = $("compare").disabled = false;
  }
}

// ---- Next-round pick (updated every round) ----
async function refreshPick() {
  if (!lastResult) return;
  try {
    const { rule, opts, result } = lastResult;
    const tail = Math.max(5000, (rule.window || 0) + 10, (rule.n || 0) + 10);
    const { crashes, round } = await loadRounds(tail);
    const next = backtest(crashes, rule, { type: "flat" }, { ...opts, curvePoints: 2 }).next;
    $("pick").textContent = next ? next.point.replace(" (instant bust)", "") : "Skip";
    $("pickInfo").innerHTML = `<b>${describe(rule)}</b><br>` +
      (next ? `For round ${round != null ? round + 1 : "next"}, this rule bets <b>${next.point}</b> (wins ${(100 * next.chance).toFixed(2)}% of the time, pays ${next.payout}×).`
            : `For round ${round != null ? round + 1 : "next"}, this rule's condition isn't met, so it skips.`) +
      `<br>This rule over the last ${num(result.rounds)} rounds: <b class="${result.returnPct >= 0 ? "good" : "bad"}">${pct(result.returnPct)}</b> (luck range ${pct(result.rangePct[0])} to ${pct(result.rangePct[1])}). ` +
      `<span class="muted">Updated ${new Date().toLocaleTimeString()}. Every round's result is set by its own hash, so this pick has the same expected loss as any other.</span>`;
  } catch (e) {
    $("pickInfo").textContent = e.message;
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.latest || changes.pending) refreshPick();
});
$("run").onclick = runRule;
$("compare").onclick = compareAll;
window.addEventListener("resize", () => lastResult && renderResult(lastResult.result, lastResult.rule, lastResult.staking));
