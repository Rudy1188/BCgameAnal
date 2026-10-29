// Statistical model for historical Crash multipliers.
//
// Input: crash multipliers in chronological order (oldest first).
// Measures historical behaviour and tests it against a configurable fair-game
// baseline. It does NOT predict future rounds: if rounds are independent and
// provably fair, past results carry no information about the next one.

// ---------------------------------------------------------------------------
// Distributions and helpers
// ---------------------------------------------------------------------------

export const Z95 = 1.959963984540054;

/** Complementary error function (Numerical Recipes erfcc, |rel err| < 1.2e-7). */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** P(Z > z) for standard normal Z. */
export const normalSf = (z) => 0.5 * erfc(z / Math.SQRT2);
/** Two-sided p-value for a z statistic. */
export const pTwo = (z) => Math.min(1, 2 * normalSf(Math.abs(z)));

/** Inverse standard normal CDF (Acklam's algorithm, |rel err| < 1.2e-9). */
export function normalInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  let q, r;
  if (p < lo) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= hi) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of g) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h);
}

/** P(chi-square with k degrees of freedom > x). */
export const chiSqSf = (x, k) => gammaQ(k / 2, x / 2);

/** P(sup |Brownian bridge| > t) (Kolmogorov distribution). */
export function kolmogorovSf(t) {
  if (t < 0.2) return 1;
  let s = 0;
  for (let k = 1; k <= 100; k++) {
    const term = Math.exp(-2 * k * k * t * t);
    s += (k % 2 ? 1 : -1) * term;
    if (term < 1e-16) break;
  }
  return Math.min(1, Math.max(0, 2 * s));
}

/** 95% (or other z) Wilson score interval for k successes in n trials. */
export function wilson(k, n, z = Z95) {
  if (!n) return { low: 0, high: 1 };
  const p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Holm–Bonferroni adjusted p-values (same order as input; null stays null). */
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length;
  const out = ps.map(() => null);
  let running = 0;
  idx.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    out[i] = running;
  });
  return out;
}

const round = (x, d = 6) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  targets: [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0],
  window: 10000,
  step: 10000,      // step for the chart series (window = step -> non-overlapping)
  houseEdge: 0.01,  // theoretical baseline p(x) = (1 - edge) / x
  alpha: 0.05,
  maxLag: 20,
  segments: 10,
  bins: [1.0, 1.01, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 5, 10, 100],
};

/** Theoretical P(C >= x) under the configured baseline. */
export const theoryHit = (x, edge) => (x <= 1 ? 1 : Math.min(1, (1 - edge) / x));

const EPS = 1e-9;

/**
 * Run the full analysis.
 * crashes: oldest first (Array or Float64Array).
 * opts: see DEFAULTS, plus newestRoundId (round ID of the last element) for labelling.
 * onProgress(text) is optional.
 */
export function analyzeHistory(crashes, options = {}, onProgress) {
  const o = { ...DEFAULTS, ...options };
  const N = crashes.length;
  const W = o.window;
  const edge = o.houseEdge;
  const roundIdOf = (i) => (o.newestRoundId != null ? o.newestRoundId - (N - 1 - i) : null); // i = chronological index
  const report = { settings: { ...o, N }, generatedAt: new Date().toISOString() };
  const progress = (t) => onProgress?.(t);

  // ---- Integrity ----
  progress("Checking data…");
  let invalid = 0, min = Infinity, max = 0, ones = 0;
  for (let i = 0; i < N; i++) {
    const c = crashes[i];
    if (!(c >= 1) || !Number.isFinite(c)) { invalid++; continue; }
    if (c < min) min = c;
    if (c > max) max = c;
    if (c < 1.01 - EPS) ones++;
  }
  const sorted = Float64Array.from(crashes).sort();
  const q = (p) => sorted[Math.min(N - 1, Math.floor(p * N))];
  report.data = {
    N, invalid, min, max,
    median: q(0.5), p90: q(0.9), p99: q(0.99),
    instantBust: { count: ones, rate: ones / N, theory: 1 - theoryHit(1.01, edge) },
    firstRoundId: roundIdOf(0), lastRoundId: roundIdOf(N - 1),
  };

  // ---- Per target ----
  const targets = o.targets;
  const Y = new Uint8Array(N);
  const prefix = new Int32Array(N + 1);
  const m = Math.floor(N / W); // non-overlapping windows, anchored at the newest end
  const offset = N - m * W;    // oldest rounds not in any full window
  const zBonf = normalInv(1 - o.alpha / (2 * Math.max(1, m) * Math.max(1, targets.filter((x) => x > 1).length)));
  const perTarget = [];

  for (const x of targets) {
    progress(`Target ${x.toFixed(1)}×…`);
    let k = 0;
    for (let i = 0; i < N; i++) { const y = crashes[i] >= x - EPS ? 1 : 0; Y[i] = y; k += y; prefix[i + 1] = prefix[i] + y; }
    const p = k / N;
    const ci = wilson(k, N);
    const p0 = theoryHit(x, edge);
    const t = { x, successes: k, N, hitRate: p, failRate: 1 - p, ci, ciHalfWidth: (ci.high - ci.low) / 2, se: Math.sqrt((p * (1 - p)) / N), theory: p0 };

    if (x > 1) {
      // ---- vs theory ----
      t.diff = p - p0;
      t.z = (p - p0) / Math.sqrt((p0 * (1 - p0)) / N);
      t.p = pTwo(t.z);
      t.theoryInCI = p0 >= ci.low && p0 <= ci.high;
      // ---- expected return ----
      t.ev = x * p - 1;
      t.roi = 100 * t.ev;
      t.evCI = { low: x * ci.low - 1, high: x * ci.high - 1 };
      t.evTheory = x * p0 - 1;

      // ---- rolling windows (non-overlapping, for testing) ----
      const wp = new Float64Array(m);
      for (let j = 0; j < m; j++) wp[j] = (prefix[offset + (j + 1) * W] - prefix[offset + j * W]) / W;
      let mean = 0; for (const v of wp) mean += v; mean /= m || 1;
      let ss = 0, wmin = Infinity, wmax = -Infinity, jmin = 0, jmax = 0;
      wp.forEach((v, j) => { ss += (v - mean) ** 2; if (v < wmin) { wmin = v; jmin = j; } if (v > wmax) { wmax = v; jmax = j; } });
      const sd = m > 1 ? Math.sqrt(ss / (m - 1)) : 0;
      const expSd = Math.sqrt((p * (1 - p)) / W);
      const chi = m > 1 ? (ss * W) / (p * (1 - p)) : 0; // Σ (k_j − W p̄)² / (W p̄ q̄)
      // Trend: OLS slope of window hit rate on window index.
      let sxx = 0, sxy = 0; const jm = (m - 1) / 2;
      wp.forEach((v, j) => { sxx += (j - jm) ** 2; sxy += (j - jm) * (v - mean); });
      const slope = sxx ? sxy / sxx : 0;
      const slopeSe = sxx ? Math.sqrt((p * (1 - p)) / W / sxx) : Infinity; // binomial variance per window
      const winRange = (j) => [roundIdOf(offset + j * W), roundIdOf(offset + (j + 1) * W - 1)];
      const flagged = [];
      wp.forEach((v, j) => {
        const z = (v - p0) / Math.sqrt((p0 * (1 - p0)) / W);
        if (Math.abs(z) > zBonf) flagged.push({ window: j, rounds: winRange(j), hitRate: v, z });
      });
      t.windows = {
        count: m, size: W, step: W, mean, sd, expectedSd: expSd, sdRatio: expSd ? sd / expSd : null,
        min: { hitRate: wmin, window: jmin, rounds: winRange(jmin) },
        max: { hitRate: wmax, window: jmax, rounds: winRange(jmax) },
        homogeneity: { chi2: chi, df: m - 1, p: m > 1 ? chiSqSf(chi, m - 1) : null },
        trend: { slopePerWindow: slope, slopePer100k: (slope * 100000) / W, z: slope / slopeSe, p: pTwo(slope / slopeSe) },
        bonferroniZ: zBonf, flagged,
      };

      // ---- chart series (may overlap) ----
      const series = [];
      for (let end = N; end - W >= 0; end -= o.step) series.push([end - 1, (prefix[end] - prefix[end - W]) / W]);
      series.reverse();
      t.series = series.map(([i, v]) => [roundIdOf(i) ?? i, round(v, 6)]);

      // ---- runs test (Wald–Wolfowitz) ----
      let runs = 1, longest1 = 0, longest0 = 0, cur = 1;
      for (let i = 1; i <= N; i++) {
        if (i < N && Y[i] === Y[i - 1]) { cur++; continue; }
        if (Y[i - 1]) longest1 = Math.max(longest1, cur); else longest0 = Math.max(longest0, cur);
        if (i < N) { runs++; cur = 1; }
      }
      const n1 = k, n0 = N - k;
      const mu = (2 * n1 * n0) / N + 1;
      const varR = ((mu - 1) * (mu - 2)) / (N - 1);
      t.runs = { runs, expected: mu, z: (runs - mu) / Math.sqrt(varR), p: pTwo((runs - mu) / Math.sqrt(varR)) };

      // ---- longest streaks vs expectation (approximate extreme-value model) ----
      const streak = (L, pr) => {
        // Runs of an outcome with probability `pr` start about N(1−pr)pr times; P(longest ≥ L) ≈ 1 − exp(−N(1−pr)pr^L).
        const lam = (Lx) => N * (1 - pr) * pr ** Lx;
        const pGe = 1 - Math.exp(-lam(L));
        const pLe = Math.exp(-lam(L + 1));
        const expected = Math.log(N * (1 - pr)) / Math.log(1 / pr);
        return { longest: L, expected, p: Math.min(1, 2 * Math.min(pGe, pLe)) };
      };
      t.streaks = { loss: streak(longest0, 1 - p), win: streak(longest1, p) };

      // ---- CUSUM change-point test ----
      let s = 0, dmax = 0, imax = 0;
      for (let i = 0; i < N; i++) { s += Y[i] - p; if (Math.abs(s) > dmax) { dmax = Math.abs(s); imax = i; } }
      const D = dmax / Math.sqrt(N * p * (1 - p));
      t.cusum = { D, p: kolmogorovSf(D), at: roundIdOf(imax) ?? imax };

      // ---- autocorrelation / Ljung–Box ----
      t.acf = acf(Y, o.maxLag, p);
    }
    perTarget.push(t);
  }

  // ---- Continuous series: probability-integral transform under the baseline ----
  progress("Autocorrelation…");
  const u = new Float64Array(N);
  for (let i = 0; i < N; i++) u[i] = 1 - theoryHit(crashes[i], edge); // ≈ uniform if the baseline holds
  const uAcf = acf(u, o.maxLag);

  // ---- Distribution vs baseline and over time ----
  progress("Distribution tests…");
  const edges = o.bins;
  const B = edges.length;
  const binOf = (c) => { let b = 0; while (b + 1 < B && c >= edges[b + 1] - EPS) b++; return b; };
  const binLabel = (b) => (b + 1 < B ? `[${edges[b]}, ${edges[b + 1]})` : `[${edges[b]}, ∞)`);
  const binP = (b) => theoryHit(edges[b], edge) - (b + 1 < B ? theoryHit(edges[b + 1], edge) : 0);
  const S = o.segments;
  const counts = Array.from({ length: S }, () => new Float64Array(B));
  const segOf = (i) => Math.min(S - 1, Math.floor((i * S) / N));
  for (let i = 0; i < N; i++) counts[segOf(i)][binOf(crashes[i])]++;
  const total = new Float64Array(B);
  counts.forEach((row) => row.forEach((v, b) => (total[b] += v)));
  let gof = 0;
  const binsOut = [];
  for (let b = 0; b < B; b++) {
    const E = N * binP(b);
    gof += (total[b] - E) ** 2 / E;
    binsOut.push({ bin: binLabel(b), observed: total[b], expected: E, residual: (total[b] - E) / Math.sqrt(E) });
  }
  const contingency = (rows) => {
    const rs = rows.map((r) => r.reduce((a, v) => a + v, 0));
    const cs = new Float64Array(B); rows.forEach((r) => r.forEach((v, b) => (cs[b] += v)));
    const n = rs.reduce((a, v) => a + v, 0);
    let chi = 0;
    rows.forEach((r, i) => r.forEach((v, b) => { const E = (rs[i] * cs[b]) / n; if (E > 0) chi += (v - E) ** 2 / E; }));
    const df = (rows.length - 1) * (B - 1);
    return { chi2: chi, df, p: chiSqSf(chi, df) };
  };
  const half = (from, to) => { const r = new Float64Array(B); for (let i = from; i < to; i++) r[binOf(crashes[i])]++; return r; };
  report.distribution = {
    bins: binsOut,
    goodnessOfFit: { chi2: gof, df: B - 1, p: chiSqSf(gof, B - 1) },
    halves: contingency([half(0, Math.floor(N / 2)), half(Math.floor(N / 2), N)]),
    segments: { count: S, ...contingency(counts) },
  };

  // ---- Multiple-testing correction (Holm within each family) ----
  progress("Multiple-testing correction…");
  const T = perTarget.filter((t) => t.x > 1);
  const families = {
    "Hit rate vs baseline": T.map((t) => [`${t.x.toFixed(1)}×`, t.p, (a) => (t.pAdj = a)]),
    "Window homogeneity": T.map((t) => [`${t.x.toFixed(1)}×`, t.windows.homogeneity.p, (a) => (t.windows.homogeneity.pAdj = a)]),
    "Window trend": T.map((t) => [`${t.x.toFixed(1)}×`, t.windows.trend.p, (a) => (t.windows.trend.pAdj = a)]),
    "Autocorrelation (Ljung–Box)": [
      ...T.map((t) => [`${t.x.toFixed(1)}×`, t.acf.ljungBox.p, (a) => (t.acf.ljungBox.pAdj = a)]),
      ["multiplier (PIT)", uAcf.ljungBox.p, (a) => (uAcf.ljungBox.pAdj = a)],
    ],
    "Runs test": T.map((t) => [`${t.x.toFixed(1)}×`, t.runs.p, (a) => (t.runs.pAdj = a)]),
    "Longest streaks": T.flatMap((t) => [
      [`${t.x.toFixed(1)}× losing streak`, t.streaks.loss.p, (a) => (t.streaks.loss.pAdj = a)],
      [`${t.x.toFixed(1)}× winning streak`, t.streaks.win.p, (a) => (t.streaks.win.pAdj = a)],
    ]),
    "Change point (CUSUM)": T.map((t) => [`${t.x.toFixed(1)}×`, t.cusum.p, (a) => (t.cusum.pAdj = a)]),
    "Distribution": [
      ["fit to baseline", report.distribution.goodnessOfFit.p, (a) => (report.distribution.goodnessOfFit.pAdj = a)],
      ["first vs second half", report.distribution.halves.p, (a) => (report.distribution.halves.pAdj = a)],
      [`${S} segments`, report.distribution.segments.p, (a) => (report.distribution.segments.pAdj = a)],
    ],
  };
  // Two levels: Holm within each family (pAdj, used for "watch" notes and the
  // score), and Holm across every test in the report (pGlobal). Only results
  // that survive the global correction are called significant.
  const tests = [];
  for (const [family, items] of Object.entries(families)) {
    const adj = holm(items.map((it) => it[1]));
    items.forEach(([name, p, set], i) => { set(adj[i]); tests.push({ family, name, p, pAdj: adj[i] }); });
  }
  const glob = holm(tests.map((t) => t.p));
  tests.forEach((t, i) => {
    t.pGlobal = glob[i];
    t.significant = glob[i] != null && glob[i] < o.alpha;
    t.watch = !t.significant && t.pAdj != null && t.pAdj < o.alpha;
  });
  report.tests = tests;
  report.targets = perTarget;
  report.dependence = { multiplierAcf: uAcf };

  // ---- Anomaly list ----
  const anomalies = tests.filter((t) => t.significant).map((t) => `${t.family}: ${t.name} (p = ${t.pGlobal.toExponential(2)} after correcting across all ${tests.length} tests)`);
  report.watch = tests.filter((t) => t.watch).map((t) =>
    `${t.family}: ${t.name} — stands out within its group (adjusted p = ${fmtP(t.pAdj)}) but not after correcting across all ${tests.length} tests (p = ${fmtP(t.pGlobal)}); consistent with chance.`);
  for (const t of T) for (const f of t.windows.flagged) {
    anomalies.push(`Window ${f.rounds[0] ?? ""}–${f.rounds[1] ?? ""} at ${t.x.toFixed(1)}×: hit rate ${(100 * f.hitRate).toFixed(2)}% (z = ${f.z.toFixed(2)}, beyond Bonferroni limit ±${zBonf.toFixed(2)})`);
  }
  if (invalid) anomalies.unshift(`${invalid} invalid multipliers in the data`);
  report.anomalies = anomalies;

  report.trust = trustScore(report, o.alpha);
  progress("");
  return report;
}

/** Autocorrelation at lags 1..h and Ljung–Box test. */
function acf(series, h, knownMean) {
  const N = series.length;
  let mean = knownMean;
  if (mean == null) { mean = 0; for (let i = 0; i < N; i++) mean += series[i]; mean /= N; }
  const d = new Float64Array(N);
  let c0 = 0;
  for (let i = 0; i < N; i++) { d[i] = series[i] - mean; c0 += d[i] * d[i]; }
  const r = [];
  let Q = 0;
  for (let k = 1; k <= h; k++) {
    let ck = 0;
    for (let i = 0; i + k < N; i++) ck += d[i] * d[i + k];
    const rk = c0 ? ck / c0 : 0;
    r.push(rk);
    Q += (rk * rk) / (N - k);
  }
  Q *= N * (N + 2);
  return { lags: r, band: Z95 / Math.sqrt(N), ljungBox: { Q, df: h, p: chiSqSf(Q, h) } };
}

/**
 * 10-point trust score: how consistent the history is with a fair game with
 * independent rounds at the configured house edge. Not a betting signal.
 */
export function trustScore(report, alpha = 0.05) {
  const T = report.targets.filter((t) => t.x > 1);
  const passShare = (ps) => (ps.length ? ps.filter((p) => p == null || p >= alpha).length / ps.length : 1);
  const items = [
    {
      name: "Data integrity", max: 1,
      score: report.data.invalid === 0 ? 1 : 0,
      detail: report.data.invalid === 0 ? "All multipliers valid (≥ 1.00×), computed from the SHA-256 hash chain." : `${report.data.invalid} invalid values.`,
    },
    {
      name: "Sample size", max: 1,
      score: Math.min(1, report.data.N / 1_000_000),
      detail: `${report.data.N.toLocaleString()} rounds (full point at 1,000,000).`,
    },
    {
      name: "Hit rates match baseline", max: 2,
      score: 2 * passShare(T.map((t) => t.pAdj)),
      detail: `${T.filter((t) => t.pAdj >= alpha).length}/${T.length} targets within expected range (Holm-adjusted).`,
    },
    {
      name: "Distribution fit", max: 1,
      score: report.distribution.goodnessOfFit.pAdj >= alpha ? 1 : 0,
      detail: `Chi-square fit to baseline, adjusted p = ${fmtP(report.distribution.goodnessOfFit.pAdj)}.`,
    },
    {
      name: "Stable across windows", max: 1,
      score: passShare(T.map((t) => t.windows.homogeneity.pAdj)),
      detail: `${T.filter((t) => t.windows.homogeneity.pAdj >= alpha).length}/${T.length} targets: window-to-window variation is ordinary sampling noise.`,
    },
    {
      name: "No trend", max: 1,
      score: passShare(T.map((t) => t.windows.trend.pAdj)),
      detail: `${T.filter((t) => t.windows.trend.pAdj >= alpha).length}/${T.length} targets: no significant drift over time.`,
    },
    {
      name: "Rounds independent (autocorrelation)", max: 1,
      score: passShare([...T.map((t) => t.acf.ljungBox.pAdj), report.dependence.multiplierAcf.ljungBox.pAdj]),
      detail: "Ljung–Box tests on hit/miss sequences and multipliers.",
    },
    {
      name: "Runs and streaks normal", max: 1,
      score: (passShare(T.map((t) => t.runs.pAdj)) + passShare(T.flatMap((t) => [t.streaks.loss.pAdj, t.streaks.win.pAdj]))) / 2,
      detail: "Wald–Wolfowitz runs tests and longest-streak checks.",
    },
    {
      name: "No change point", max: 1,
      score: (passShare(T.map((t) => t.cusum.pAdj)) + passShare([report.distribution.halves.pAdj, report.distribution.segments.pAdj])) / 2,
      detail: "CUSUM tests and early-vs-late distribution comparisons.",
    },
  ];
  const total = items.reduce((a, it) => a + it.score, 0);
  const failing = [...new Set((report.tests || []).filter((t) => t.significant).map((t) => t.family))];
  const watching = (report.tests || []).filter((t) => t.watch).length;
  let level, rating;
  if (!failing.length && total >= 9) {
    level = "good";
    rating = "Consistent with a fair game with independent rounds. No statistically significant deviations after correction" +
      (watching ? ` (${watching} minor note${watching > 1 ? "s" : ""}, consistent with chance).` : ".");
  } else if (!failing.length) {
    level = "warn";
    rating = "No significant deviations, but the evidence is limited (see sample size and data integrity).";
  } else {
    level = total >= 7 ? "warn" : "bad";
    rating = `Statistically unusual results in: ${failing.join(", ")}. First check the salt, house-edge setting and data, then investigate. This is not a betting signal.`;
  }
  return { score: Math.round(total * 10) / 10, max: 10, level, rating, failing, items };
}

export const fmtP = (p) => (p == null ? "–" : p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
