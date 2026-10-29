// Statistical report from the command line.
// Usage: npm run report -- <latestHash> [rounds=1000000] [latestRoundId] [--edge=0.01] [--detail] [--json=out.json]
import { writeFileSync } from "node:fs";
import { history, isHash, DEFAULT_SALT } from "../extension/crash.js";
import { analyzeHistory, fmtP, lab } from "../extension/statmodel.js";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [hash = "", nArg = "1000000", roundArg] = args.filter((a) => !a.startsWith("--"));
if (!isHash(hash)) {
  console.error("Usage: npm run report -- <latestHash> [rounds=1000000] [latestRoundId] [--edge=0.01] [--salt=...] [--json=out.json]");
  process.exit(1);
}
const N = Number(nArg) || 1_000_000;
const roundId = roundArg ? Number(roundArg) : null;
const salt = flags.salt || DEFAULT_SALT;

console.error(`Calculating ${N.toLocaleString()} rounds…`);
const rounds = await history(hash, N, roundId, salt);
const chrono = new Float64Array(N);
for (let i = 0; i < N; i++) chrono[i] = rounds[N - 1 - i].crash; // oldest first
console.error("Analysing…");
const r = analyzeHistory(chrono, { houseEdge: Number(flags.edge ?? 0.01), newestRoundId: roundId });

const pct = (x, d = 3) => (100 * x).toFixed(d) + "%";
const pad = (s, n) => String(s).padStart(n);
console.log(`\nBC.Game Crash statistical report — ${N.toLocaleString()} rounds` + (roundId ? ` (rounds ${r.data.firstRoundId}–${r.data.lastRoundId})` : ""));
console.log(`Baseline: p(x) = ${1 - r.settings.houseEdge}/x · windows ${r.settings.window.toLocaleString()} (non-overlapping) · α = ${r.settings.alpha}, Holm-corrected\n`);
const T = r.targets.filter((t) => t.x > 1);
console.log("Point   Hit rate  (theory)   ROI      Win vs loss            Hit rate after a loss   Longest losing streak   Score");
for (const t of T) {
  console.log(`${pad(lab(t.x), 6)}  ${pad(pct(t.hitRate, 2), 8)}  (${pad(pct(t.theory, 2), 7)})  ${pad(t.roi.toFixed(2) + "%", 7)}  ${t.payoff.padEnd(20)}   ${pad(pct(t.after.loss.hitRate, 2), 20)}   ${pad(t.streaks.loss.longest, 20)}   ${pad(t.score.score, 3)}/10${t.score.failed.length ? "  (" + t.score.failed.join(", ") + ")" : ""}`);
}
const rois = T.map((t) => t.roi);
console.log(`\nBest point for earning: none. Historical ROI ranges from ${Math.min(...rois).toFixed(2)}% to ${Math.max(...rois).toFixed(2)}% across all ${T.length} points — every point loses about ${(100 * r.settings.houseEdge).toFixed(0)}% on average.`);
console.log("A higher score means the point behaved more like a fair game, not that it pays more. After a loss, the next round's hit rate is the same as usual.");
console.log(`Overall trust score: ${r.trust.score}/10 — ${r.trust.rating}`);
if (!flags.detail) console.log("\n(Add --detail for confidence intervals, rolling windows, dependence and distribution tests.)");
else {
console.log("Target   Hits      Hit rate   95% Wilson CI          Theory    Diff (pp)  adj. p    EV/unit   ROI");
  for (const t of r.targets) {
    const base = `${pad(lab(t.x), 5)}  ${pad(t.successes, 8)}  ${pad(pct(t.hitRate), 9)}  [${pct(t.ci.low)}, ${pct(t.ci.high)}]`;
    if (t.x <= 1) { console.log(`${base}  ${pad(pct(t.theory), 8)}  (every round reaches 1.0×)`); continue; }
    console.log(`${base}  ${pad(pct(t.theory), 8)}  ${pad((100 * t.diff).toFixed(3), 8)}  ${pad(fmtP(t.pAdj), 7)}${t.pAdj < r.settings.alpha ? "*" : " "}  ${pad(t.ev.toFixed(4), 8)}  ${pad(t.roi.toFixed(2) + "%", 7)}`);
  }
  console.log("\nRolling windows (hit rate per 10,000 rounds)");
  console.log("Target  Windows  Mean      SD       Expected SD  Min       Max       Trend/100k   trend p   homog. p  flagged");
  for (const t of r.targets.filter((t) => t.x > 1)) {
    const w = t.windows;
    console.log(`${pad(lab(t.x), 5)}  ${pad(w.count, 7)}  ${pad(pct(w.mean), 8)}  ${pad(pct(w.sd), 7)}  ${pad(pct(w.expectedSd), 11)}  ${pad(pct(w.min.hitRate, 2), 8)}  ${pad(pct(w.max.hitRate, 2), 8)}  ${pad((100 * w.trend.slopePer100k).toFixed(4) + "pp", 11)}  ${pad(fmtP(w.trend.pAdj), 7)}  ${pad(fmtP(w.homogeneity.pAdj), 8)}  ${w.flagged.length}`);
  }
  console.log("\nDependence");
  console.log("Target  lag-1 r    Ljung–Box p  Runs z   runs p   Longest loss (exp)  Longest win (exp)  CUSUM p");
  for (const t of r.targets.filter((t) => t.x > 1)) {
    console.log(`${pad(lab(t.x), 5)}  ${pad(t.acf.lags[0].toFixed(5), 8)}  ${pad(fmtP(t.acf.ljungBox.pAdj), 11)}  ${pad(t.runs.z.toFixed(2), 6)}  ${pad(fmtP(t.runs.pAdj), 7)}  ${pad(`${t.streaks.loss.longest} (${t.streaks.loss.expected.toFixed(1)})`, 18)}  ${pad(`${t.streaks.win.longest} (${t.streaks.win.expected.toFixed(1)})`, 17)}  ${pad(fmtP(t.cusum.pAdj), 7)}`);
  }
  const d = r.distribution;
  console.log(`\nDistribution: fit to baseline p = ${fmtP(d.goodnessOfFit.pAdj)} · first vs second half p = ${fmtP(d.halves.pAdj)} · ${d.segments.count} segments p = ${fmtP(d.segments.pAdj)} (adjusted)`);
  console.log(`Instant bust (< 1.01×): ${pct(r.data.instantBust.rate)} vs ${pct(r.data.instantBust.theory)} expected`);
  console.log(`\nAnomalies: ${r.anomalies.length ? "\n  - " + r.anomalies.join("\n  - ") : `none after correcting across all ${r.tests.length} tests`}`);
  if (r.watch.length) console.log(`Notes:\n  - ${r.watch.join("\n  - ")}`);
  console.log(`\nTrust score: ${r.trust.score}/10 — ${r.trust.rating}`);
  for (const it of r.trust.items) console.log(`  ${pad(it.score.toFixed(1), 4)}/${it.max}  ${it.name.padEnd(38)} ${it.detail}`);
  console.log("\nHistorical estimates only. They do not predict future rounds; with a fair game every target's expected return is about −1%.");
}
if (flags.json) { writeFileSync(flags.json, JSON.stringify(r, null, 1)); console.error(`Saved ${flags.json}`); }
