import { Chain } from "./chain.js";
import { drawChart } from "./charts.js";
import { fmtP } from "./statmodel.js";

const $ = (id) => document.getElementById(id);
const pct = (x, d = 3) => (100 * x).toFixed(d) + "%";
const pp = (x, d = 3) => (x >= 0 ? "+" : "") + (100 * x).toFixed(d);
const num = (x) => x.toLocaleString();
const C = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let latest = null;
let report = null;
const chain = new Chain();
const worker = new Worker(new URL("./statsworker.js", import.meta.url), { type: "module" });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  if (!latest) { $("progress").textContent = "No round saved yet. Open bc.game/game/crash, then click the extension icon."; return; }
  const N = Number($("n").value);
  const options = {
    window: Math.max(100, Number($("window").value) || 10000),
    step: Number($("step").value),
    houseEdge: Math.max(0, Number($("edge").value) || 0) / 100,
    alpha: Number($("alpha").value) || 0.05,
  };
  $("run").disabled = true;
  try {
    chain.setLatest(latest);
    await chain.extendTo(N, (d, t) => ($("progress").textContent = `Calculating rounds: ${num(d)} / ${num(t)}…`));
    const newest = chain.crashes;
    const n = Math.min(N, newest.length);
    const chrono = new Float64Array(n);
    for (let i = 0; i < n; i++) chrono[i] = newest[n - 1 - i]; // oldest first
    options.newestRoundId = chain.latest.roundId;
    $("progress").textContent = "Analysing…";
    report = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.progress != null) $("progress").textContent = data.progress ? `Analysing: ${data.progress}` : "";
        if (data.error) reject(new Error(data.error));
        if (data.done) resolve(data.report);
      };
      worker.postMessage({ crashes: chrono, options }, [chrono.buffer]);
    });
    $("progress").textContent = `Done: ${num(report.data.N)} rounds` + (report.data.firstRoundId != null ? ` (rounds ${report.data.firstRoundId}–${report.data.lastRoundId})` : "") + ".";
    render();
  } catch (e) {
    $("progress").textContent = "Failed: " + e.message;
  } finally {
    $("run").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  $("out").hidden = false;
  $("json").disabled = $("csv").disabled = false;
  renderTrust();
  renderSummary();
  renderWindows();
  renderDependence();
  renderDistribution();
  renderAnomalies();
  renderLimits();
}

const T = () => report.targets.filter((t) => t.x > 1);
const mark = (t) => (t.significant ? ` <span class="flag" title="Significant after correcting across all tests">●</span>` : t.watch ? ` <span class="watchmark" title="Stands out within its group only">○</span>` : "");
const testOf = (family, name) => report.tests.find((t) => t.family === family && t.name === name) || {};

function renderTrust() {
  const tr = report.trust;
  $("trustCard").innerHTML = `
    <h2>Trust score</h2>
    <p class="sub">How consistent this history is with a fair game with independent rounds at a ${(100 * report.settings.houseEdge).toFixed(1)}% house edge. Not a betting signal.</p>
    <div class="score">
      <div class="big ${tr.level}">${tr.score}<small> / 10</small></div>
      <div class="rating ${tr.level}">${tr.rating}</div>
    </div>
    <div class="tablewrap"><table class="t" style="margin-top:10px">
      <thead><tr><th>Check</th><th>Points</th><th style="text-align:left">Score</th><th style="text-align:left">Details</th></tr></thead>
      <tbody>${tr.items.map((it) => `<tr><td>${it.name}</td><td>${it.score.toFixed(1)} / ${it.max}</td>
        <td><div class="bar"><i style="width:${(100 * it.score) / it.max}%"></i></div></td><td style="text-align:left;white-space:normal">${it.detail}</td></tr>`).join("")}</tbody>
    </table></div>`;
}

function renderSummary() {
  const a = report.settings.alpha;
  $("summaryCard").innerHTML = `
    <h2>Hit rates, confidence intervals and expected return</h2>
    <p class="sub">Success = crash ≥ target. 95% Wilson intervals. Baseline p(x) = ${(1 - report.settings.houseEdge).toFixed(3)}/x. EV assumes a win pays the target in total (stake included); check bc.game's payout rules before relying on it.</p>
    <div class="tablewrap"><table class="t">
      <thead><tr><th>Target</th><th>Hits</th><th>Rounds</th><th>Hit rate</th><th>Fail rate</th><th>95% CI</th><th>± (half-width)</th>
        <th>Baseline</th><th>Diff (pp)</th><th>z</th><th>p (group)</th><th>p (all tests)</th><th>EV / unit</th><th>ROI</th><th>ROI 95% CI</th></tr></thead>
      <tbody>${report.targets.map((t) => t.x <= 1
        ? `<tr><td>${t.x.toFixed(1)}×</td><td>${num(t.successes)}</td><td>${num(t.N)}</td><td>${pct(t.hitRate)}</td><td>${pct(t.failRate)}</td><td colspan="10" style="text-align:left;color:var(--muted)">Every round reaches 1.0×; no bet, no test.</td></tr>`
        : (() => { const ts = testOf("Hit rate vs baseline", `${t.x.toFixed(1)}×`); return `<tr>
          <td>${t.x.toFixed(1)}×${mark(ts)}</td><td>${num(t.successes)}</td><td>${num(t.N)}</td><td>${pct(t.hitRate)}</td><td>${pct(t.failRate)}</td>
          <td>[${pct(t.ci.low)}, ${pct(t.ci.high)}]</td><td>${pct(t.ciHalfWidth)}</td><td>${pct(t.theory)}</td>
          <td>${pp(t.diff)}</td><td>${t.z.toFixed(2)}</td><td>${fmtP(t.pAdj)}</td><td>${fmtP(ts.pGlobal)}</td>
          <td class="${t.ev >= 0 ? "hi" : "lo"}">${t.ev.toFixed(4)}</td><td class="${t.roi >= 0 ? "hi" : "lo"}">${t.roi.toFixed(2)}%</td>
          <td>[${(100 * t.evCI.low).toFixed(2)}%, ${(100 * t.evCI.high).toFixed(2)}%]</td></tr>`; })()).join("")}</tbody>
    </table></div>
    <div class="chartbar legend"><span>Observed − baseline (percentage points) with 95% CI</span></div>
    <canvas id="diffChart"></canvas>
    <div class="chartbar legend"><span>Historical ROI per target with 95% CI; dashed: baseline ROI (${(-100 * report.settings.houseEdge).toFixed(1)}%)</span></div>
    <canvas id="roiChart"></canvas>
    <p class="sub">● significant after correcting across all ${report.tests.length} tests · ○ stands out only within its group of tests (α = ${a}).</p>`;

  const ts = T();
  const lo = Math.min(0, ...ts.map((t) => t.ci.low - t.theory)), hi = Math.max(0, ...ts.map((t) => t.ci.high - t.theory));
  const padY = (hi - lo) * 0.15 || 0.001;
  drawChart($("diffChart"), {
    height: 220, x: [1.05, 2.05], y: [lo - padY, hi + padY], xFormat: (v) => v.toFixed(1) + "×", yFormat: (v) => (100 * v).toFixed(2),
    yLabel: "pp",
    layers: [
      { type: "hline", y: 0, color: C("--muted"), dash: [4, 3], width: 1 },
      { type: "errorbars", color: C("--accent"), points: ts.map((t) => [t.x, t.diff, t.ci.low - t.theory, t.ci.high - t.theory]) },
    ],
  });
  const rlo = Math.min(...ts.map((t) => t.evCI.low), -report.settings.houseEdge), rhi = Math.max(...ts.map((t) => t.evCI.high), 0);
  const rp = (rhi - rlo) * 0.15 || 0.001;
  drawChart($("roiChart"), {
    height: 200, x: [1.05, 2.05], y: [rlo - rp, rhi + rp], xFormat: (v) => v.toFixed(1) + "×", yFormat: (v) => (100 * v).toFixed(1) + "%",
    layers: [
      { type: "hline", y: 0, color: C("--muted"), width: 1 },
      { type: "hline", y: -report.settings.houseEdge, color: C("--big"), dash: [4, 3], width: 1 },
      { type: "errorbars", color: C("--low"), points: ts.map((t) => [t.x, t.ev, t.evCI.low, t.evCI.high]) },
    ],
  });
}

function renderWindows() {
  const s = report.settings;
  const any = T()[0];
  $("windowsCard").innerHTML = `
    <h2>Rolling windows</h2>
    <p class="sub">Tests use ${num(any.windows.count)} non-overlapping windows of ${num(s.window)} rounds (step ${num(s.window)}), anchored at the newest round. The chart uses step ${num(s.step)}${s.step < s.window ? " (overlapping windows, for display only)" : ""}.
      "Expected SD" is the spread pure chance would give; homogeneity tests whether windows differ more than that. Single windows are flagged only beyond the Bonferroni limit ±${any.windows.bonferroniZ.toFixed(2)}σ (all windows × targets).</p>
    <div class="tablewrap"><table class="t">
      <thead><tr><th>Target</th><th>Windows</th><th>Mean</th><th>SD</th><th>Expected SD</th><th>SD ratio</th><th>Min (rounds)</th><th>Max (rounds)</th>
        <th>Trend / 100k rounds</th><th>Trend p</th><th>Homogeneity χ²</th><th>Homog. p</th><th>Flagged windows</th></tr></thead>
      <tbody>${T().map((t) => { const w = t.windows; const tt = testOf("Window trend", `${t.x.toFixed(1)}×`), th = testOf("Window homogeneity", `${t.x.toFixed(1)}×`); return `<tr>
        <td>${t.x.toFixed(1)}×</td><td>${w.count}</td><td>${pct(w.mean)}</td><td>${pct(w.sd)}</td><td>${pct(w.expectedSd)}</td><td>${w.sdRatio?.toFixed(2) ?? "–"}</td>
        <td>${pct(w.min.hitRate, 2)} <span class="muted">(${w.min.rounds[0] ?? ""}–${w.min.rounds[1] ?? ""})</span></td>
        <td>${pct(w.max.hitRate, 2)} <span class="muted">(${w.max.rounds[0] ?? ""}–${w.max.rounds[1] ?? ""})</span></td>
        <td>${pp(w.trend.slopePer100k, 4)} pp</td><td>${fmtP(w.trend.pAdj)}${mark(tt)}</td><td>${w.homogeneity.chi2.toFixed(1)} (df ${w.homogeneity.df})</td>
        <td>${fmtP(w.homogeneity.pAdj)}${mark(th)}</td><td class="${w.flagged.length ? "flag" : ""}">${w.flagged.length}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <div class="chartbar">Chart target <select id="winTarget">${T().map((t) => `<option value="${t.x}" ${t.x === 2 ? "selected" : ""}>${t.x.toFixed(1)}×</option>`).join("")}</select>
      <span class="legend"><span style="color:var(--accent)">— window hit rate</span><span style="color:var(--big)">- - baseline</span><span>shaded: ±1.96σ (light) and Bonferroni limit (faint)</span></span></div>
    <canvas id="winChart"></canvas>`;
  const draw = () => {
    const t = T().find((t) => t.x === Number($("winTarget").value));
    const pts = t.series;
    if (!pts.length) return;
    const W = s.window, p0 = t.theory;
    const sd = Math.sqrt((p0 * (1 - p0)) / W), zb = t.windows.bonferroniZ;
    const xs = [pts[0][0], pts[pts.length - 1][0]];
    const vals = pts.map((p) => p[1]);
    const lo = Math.min(...vals, p0 - zb * sd), hi = Math.max(...vals, p0 + zb * sd);
    const band = (k) => ({ upper: xs.map((x) => [x, p0 + k * sd]), lower: xs.map((x) => [x, p0 - k * sd]) });
    drawChart($("winChart"), {
      height: 260, x: xs, y: [lo - sd * 0.5, hi + sd * 0.5], xFormat: (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : num(Math.round(v))), yFormat: (v) => (100 * v).toFixed(1) + "%",
      xLabel: report.data.firstRoundId != null ? "round ID (window end)" : "round (window end)",
      layers: [
        { type: "band", ...band(zb), color: C("--accent"), alpha: 0.07 },
        { type: "band", ...band(Z), color: C("--accent"), alpha: 0.15 },
        { type: "hline", y: p0, color: C("--big"), dash: [5, 4], width: 1 },
        { type: "line", points: pts, color: C("--accent"), width: 1.3 },
      ],
    });
  };
  $("winTarget").onchange = draw;
  draw();
}
const Z = 1.959963984540054;

function renderDependence() {
  $("depCard").innerHTML = `
    <h2>Dependence and streaks</h2>
    <p class="sub">If rounds are independent, autocorrelations stay inside ±1.96/√N, runs match their expected count, and longest streaks are close to what chance gives for this many rounds.
      Ljung–Box uses lags 1–${report.settings.maxLag}. CUSUM looks for a point where the hit rate shifted. Streak p-values use an approximate extreme-value model.</p>
    <div class="tablewrap"><table class="t">
      <thead><tr><th>Target</th><th>Lag-1 r</th><th>Ljung–Box Q</th><th>p</th><th>Runs</th><th>Expected</th><th>z</th><th>p</th>
        <th>Longest losing (expected)</th><th>p</th><th>Longest winning (expected)</th><th>p</th><th>CUSUM D</th><th>p</th></tr></thead>
      <tbody>${T().map((t) => { const n = `${t.x.toFixed(1)}×`; return `<tr><td>${n}</td><td>${t.acf.lags[0].toFixed(5)}</td>
        <td>${t.acf.ljungBox.Q.toFixed(1)}</td><td>${fmtP(t.acf.ljungBox.pAdj)}${mark(testOf("Autocorrelation (Ljung–Box)", n))}</td>
        <td>${num(t.runs.runs)}</td><td>${num(Math.round(t.runs.expected))}</td><td>${t.runs.z.toFixed(2)}</td><td>${fmtP(t.runs.pAdj)}${mark(testOf("Runs test", n))}</td>
        <td>${t.streaks.loss.longest} (${t.streaks.loss.expected.toFixed(1)})</td><td>${fmtP(t.streaks.loss.pAdj)}${mark(testOf("Longest streaks", n + " losing streak"))}</td>
        <td>${t.streaks.win.longest} (${t.streaks.win.expected.toFixed(1)})</td><td>${fmtP(t.streaks.win.pAdj)}${mark(testOf("Longest streaks", n + " winning streak"))}</td>
        <td>${t.cusum.D.toFixed(3)}</td><td>${fmtP(t.cusum.pAdj)}${mark(testOf("Change point (CUSUM)", n))}</td></tr>`; }).join("")}
      <tr><td>Multiplier</td><td>${report.dependence.multiplierAcf.lags[0].toFixed(5)}</td><td>${report.dependence.multiplierAcf.ljungBox.Q.toFixed(1)}</td>
        <td>${fmtP(report.dependence.multiplierAcf.ljungBox.pAdj)}${mark(testOf("Autocorrelation (Ljung–Box)", "multiplier (PIT)"))}</td><td colspan="10" style="text-align:left;color:var(--muted)">Autocorrelation of the multipliers themselves (transformed to 0–1 under the baseline).</td></tr></tbody>
    </table></div>
    <div class="chartbar">Autocorrelation for <select id="acfTarget">${T().map((t) => `<option value="${t.x}" ${t.x === 2 ? "selected" : ""}>${t.x.toFixed(1)}× hit/miss</option>`).join("")}<option value="pit">multiplier</option></select>
      <span class="legend"><span>bars: correlation at each lag · dashed: ±1.96/√N</span></span></div>
    <canvas id="acfChart"></canvas>`;
  const draw = () => {
    const v = $("acfTarget").value;
    const a = v === "pit" ? report.dependence.multiplierAcf : T().find((t) => t.x === Number(v)).acf;
    const m = Math.max(a.band * 1.6, ...a.lags.map(Math.abs)) * 1.15;
    drawChart($("acfChart"), {
      height: 200, x: [0.3, a.lags.length + 0.7], y: [-m, m], xFormat: (v) => (Number.isInteger(v) ? String(v) : ""), yFormat: (v) => v.toFixed(4), xLabel: "lag",
      layers: [
        { type: "bars", points: a.lags.map((r, i) => [i + 1, r]), colorOf: (r) => (Math.abs(r) > a.band ? C("--big") : C("--accent")) },
        { type: "hline", y: a.band, color: C("--muted"), dash: [4, 3], width: 1 },
        { type: "hline", y: -a.band, color: C("--muted"), dash: [4, 3], width: 1 },
        { type: "hline", y: 0, color: C("--muted"), width: 1 },
      ],
    });
  };
  $("acfTarget").onchange = draw;
  draw();
}

function renderDistribution() {
  const d = report.distribution;
  $("distCard").innerHTML = `
    <h2>Distribution</h2>
    <p class="sub">Observed vs baseline counts per multiplier range. Residual = (observed − expected)/√expected; values beyond about ±3 deserve a look.
      Instant bust (&lt; 1.01×): ${pct(report.data.instantBust.rate)} observed vs ${pct(report.data.instantBust.theory)} expected.
      Median ${report.data.median.toFixed(2)}×, 90th percentile ${report.data.p90.toFixed(2)}×, 99th percentile ${report.data.p99.toFixed(2)}×, highest ${num(report.data.max)}×.</p>
    <div class="tablewrap"><table class="t">
      <thead><tr><th>Range</th><th>Observed</th><th>Expected</th><th>Observed %</th><th>Expected %</th><th>Residual</th></tr></thead>
      <tbody>${d.bins.map((b) => `<tr><td>${b.bin}</td><td>${num(b.observed)}</td><td>${num(Math.round(b.expected))}</td>
        <td>${pct(b.observed / report.data.N)}</td><td>${pct(b.expected / report.data.N)}</td><td class="${Math.abs(b.residual) > 3 ? "flag" : ""}">${b.residual.toFixed(2)}</td></tr>`).join("")}</tbody>
    </table></div>
    <table class="t" style="margin-top:10px">
      <thead><tr><th>Test</th><th>χ²</th><th>df</th><th>p (group)</th><th>p (all tests)</th></tr></thead>
      <tbody>
        ${[["Fit to baseline", d.goodnessOfFit, "fit to baseline"], ["First half vs second half", d.halves, "first vs second half"], [`${d.segments.count} equal segments`, d.segments, `${d.segments.count} segments`]].map(([label, t, name]) =>
          `<tr><td>${label}</td><td>${t.chi2.toFixed(1)}</td><td>${t.df}</td><td>${fmtP(t.pAdj)}</td><td>${fmtP(testOf("Distribution", name).pGlobal)}${mark(testOf("Distribution", name))}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function renderAnomalies() {
  const watchItems = report.watch;
  $("anomalyCard").innerHTML = `
    <h2>Anomaly and stability report</h2>
    <p class="sub">${report.tests.length} tests were run. With α = ${report.settings.alpha}, about ${(report.tests.length * report.settings.alpha).toFixed(1)} would show p &lt; ${report.settings.alpha} by chance alone, so p-values are corrected with Holm's method, both within each group and across all tests.</p>
    <h2 style="font-size:13px;margin-top:10px">Significant findings</h2>
    ${report.anomalies.length ? `<ul class="list">${report.anomalies.map((a) => `<li class="flag">${a}</li>`).join("")}</ul>` : `<p class="good">None after multiple-testing correction.</p>`}
    <h2 style="font-size:13px;margin-top:10px">Notes</h2>
    ${watchItems.length ? `<ul class="list">${watchItems.map((a) => `<li class="warn">${a}</li>`).join("")}</ul>` : `<p class="muted">None.</p>`}`;
}

function renderLimits() {
  $("limits").innerHTML = `
    <h2 style="color:var(--text)">Limitations and how to read this</h2>
    <p><b>No prediction.</b> Each round's result comes from its own hash. If the game is provably fair and rounds are independent, past results say nothing about the next round. Streaks, "due" outcomes and window swings here are descriptions of the past, not signals.</p>
    <p><b>Expected return is negative.</b> Under the baseline every target has the same expected return of about −${(100 * report.settings.houseEdge).toFixed(1)}% per bet. Historical ROI that differs a little from that is sampling noise; its confidence interval shows how much. No betting strategy built from these numbers changes the expected return.</p>
    <p><b>Baseline is an assumption.</b> p(x) = (1 − edge)/x matches bc.game's published formula (crash = ⌊99/(1−X)⌋/100) for targets with two decimals, but versions and payout rules can change. Check them before relying on the EV figures.</p>
    <p><b>Statistical significance.</b> A small p-value means "unlikely under the baseline", not "exploitable". Even a perfectly fair game will show at least one finding in roughly 5–10% of reports at α = 0.05 (tested on simulated fair data). Look for findings that repeat across sample sizes and settings. A low score usually means a wrong salt, edge setting or data first.</p>
    <p><b>Data source.</b> Results are calculated from the saved latest hash using the SHA-256 chain and the salt shown. They are only as trustworthy as that hash: confirm it against bc.game's own round details.</p>
    <p><b>Approximations.</b> Streak p-values use an extreme-value approximation; trend tests use a normal approximation; targets are nested (a 2× hit is also a 1.5× hit), so tests across targets are correlated and the corrections are conservative.</p>`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("json").onclick = () => download(`crash-report-${report.data.N}.json`, JSON.stringify(report, null, 1), "application/json");
$("csv").onclick = () => {
  const head = "target,hits,rounds,hit_rate,fail_rate,ci_low,ci_high,baseline,diff,z,p_group,p_all,ev,roi_pct,roi_ci_low_pct,roi_ci_high_pct,window_mean,window_sd,window_expected_sd,trend_per_100k,trend_p,homogeneity_p,ljung_box_p,runs_p,cusum_p";
  const rows = T().map((t) => [t.x, t.successes, t.N, t.hitRate, t.failRate, t.ci.low, t.ci.high, t.theory, t.diff, t.z, t.pAdj,
    testOf("Hit rate vs baseline", `${t.x.toFixed(1)}×`).pGlobal, t.ev, t.roi, 100 * t.evCI.low, 100 * t.evCI.high,
    t.windows.mean, t.windows.sd, t.windows.expectedSd, t.windows.trend.slopePer100k, t.windows.trend.pAdj, t.windows.homogeneity.pAdj,
    t.acf.ljungBox.pAdj, t.runs.pAdj, t.cusum.pAdj].join(","));
  download(`crash-report-${report.data.N}.csv`, [head, ...rows].join("\n"), "text/csv");
};

$("run").onclick = run;
window.addEventListener("resize", () => report && (renderSummary(), renderWindows(), renderDependence()));

(async () => {
  ({ latest = null } = await chrome.storage.local.get("latest"));
  $("progress").textContent = latest
    ? `Latest saved round: ${latest.roundId ?? "unknown"}. Choose settings and click Run analysis.`
    : "No round saved yet. Open bc.game/game/crash, then click the extension icon.";
})();
