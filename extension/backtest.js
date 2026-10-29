// Strategy tester: replays a betting rule over historical rounds.
// Each decision uses only rounds before the one being bet on.
import { defaultTargets, liveScores, theoryHit } from "./statmodel.js";

const EPS = 1e-9;

/** 28 points: exact 1.00× (instant bust) plus the 27 cash-out targets. */
export function points(bustPayout = 49.99) {
  return [
    { id: "bust", label: "1.00× (instant bust)", x: 1, bust: true, payout: bustPayout, p0: 1 - theoryHit(1.01, 0.01) },
    ...defaultTargets().map((x) => ({ id: String(x), label: `${+x.toFixed(2)}×`, x, bust: false, payout: x, p0: theoryHit(x, 0.01) })),
  ];
}

const hits = (c, pt) => (pt.bust ? c < 1.01 - EPS : c >= pt.x - EPS);

export const RULES = {
  fixed: { name: "Always bet a point", params: ["point"] },
  afterLosses: { name: "Bet a point after N losses in a row at that point", params: ["point", "n"] },
  afterLow: { name: "Bet a point after a round below Y", params: ["point", "y"] },
  afterHigh: { name: "Bet a point after a round at or above Y", params: ["point", "y"] },
  bestRoi: { name: "Pick the point with the best ROI over the last W rounds", params: ["window"] },
  due: { name: "Pick the most 'due' point (furthest below normal) over the last W rounds", params: ["window"] },
  bestScore: { name: "Pick the point with the highest score over the last W rounds (updated every 500 rounds)", params: ["window"] },
  random: { name: "Pick a random point each round", params: [] },
};

/**
 * crashes: oldest first. rule: { type, point (id), n, y, window }.
 * staking: { type: "flat" | "martingale", base, factor, maxSteps, bankroll }.
 * Returns stats, an equity curve, and the rule's pick for the next round.
 */
export function backtest(crashes, rule, staking = {}, { bustPayout = 49.99, curvePoints = 1500, onProgress } = {}) {
  const N = crashes.length;
  const PTS = points(bustPayout);
  const byId = Object.fromEntries(PTS.map((p, i) => [p.id, i]));
  const W = Math.max(10, rule.window | 0 || 2000);
  const st = { type: "flat", base: 1, factor: 2, maxSteps: 10, bankroll: 0, ...staking };
  const needsWindow = ["bestRoi", "due", "bestScore"].includes(rule.type);
  const start = needsWindow ? W : rule.type === "afterLosses" ? rule.n | 0 : 1;

  // Rolling hit counts per point over the last W rounds (for window rules).
  const cnt = new Float64Array(PTS.length);
  if (needsWindow) for (let i = 0; i < Math.min(W, N); i++) PTS.forEach((p, k) => (cnt[k] += hits(crashes[i], p)));

  let lossRun = 0;         // consecutive misses at the fixed point
  let scoreCache = -1, scoreAt = -Infinity;
  let rng = 0x9e3779b9;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  // Decide which point (index) to bet on round i, or -1 to skip.
  function decide(i) {
    switch (rule.type) {
      case "fixed": return byId[rule.point];
      case "afterLosses": return lossRun >= (rule.n | 0) ? byId[rule.point] : -1;
      case "afterLow": return i > 0 && crashes[i - 1] < rule.y - EPS ? byId[rule.point] : -1;
      case "afterHigh": return i > 0 && crashes[i - 1] >= rule.y - EPS ? byId[rule.point] : -1;
      case "bestRoi": {
        let b = 0, v = -Infinity;
        PTS.forEach((p, k) => { const roi = (p.payout * cnt[k]) / W - 1; if (roi > v) { v = roi; b = k; } });
        return b;
      }
      case "due": {
        let b = 0, v = Infinity;
        PTS.forEach((p, k) => { const z = (cnt[k] / W - p.p0) / Math.sqrt((p.p0 * (1 - p.p0)) / W); if (z < v) { v = z; b = k; } });
        return b;
      }
      case "bestScore": {
        if (i - scoreAt >= 500) { // recalculated every 500 rounds (speed)
          const recent = new Float64Array(W);
          for (let j = 0; j < W; j++) recent[j] = crashes[i - 1 - j];
          const s = liveScores(recent, W);
          let best = s[0];
          for (const t of s) if (t.score > best.score) best = t;
          scoreCache = byId[String(best.x)];
          scoreAt = i;
        }
        return scoreCache;
      }
      case "random": return Math.floor(rand() * PTS.length);
      default: return -1;
    }
  }

  let bets = 0, wins = 0, staked = 0, profit = 0, variance = 0, expected = 0;
  let peak = 0, maxDD = 0, longestLoss = 0, curLoss = 0, maxStake = 0, step = 0;
  let bankroll = st.bankroll > 0 ? st.bankroll : Infinity, bustAt = null;
  const perPoint = new Map();
  const curve = [];
  const every = Math.max(1, Math.floor(N / curvePoints));

  for (let i = start; i < N; i++) {
    const k = bustAt == null ? decide(i) : -1;
    if (k >= 0) {
      const pt = PTS[k];
      let stake = st.type === "martingale" ? st.base * st.factor ** Math.min(step, st.maxSteps) : st.base;
      if (stake > bankroll) { bustAt = i; }
      else {
        const win = hits(crashes[i], pt);
        const gain = win ? stake * (pt.payout - 1) : -stake;
        bets++; staked += stake; profit += gain; bankroll -= win ? -stake * (pt.payout - 1) : stake;
        expected += stake * (pt.payout * pt.p0 - 1);
        variance += stake * stake * pt.payout * pt.payout * pt.p0 * (1 - pt.p0);
        if (stake > maxStake) maxStake = stake;
        if (win) { wins++; curLoss = 0; step = 0; } else { curLoss++; step++; if (curLoss > longestLoss) longestLoss = curLoss; if (step > st.maxSteps) step = 0; }
        if (profit > peak) peak = profit;
        if (peak - profit > maxDD) maxDD = peak - profit;
        const pp = perPoint.get(pt.label) || { bets: 0, staked: 0, profit: 0 };
        pp.bets++; pp.staked += stake; pp.profit += gain; perPoint.set(pt.label, pp);
      }
    }
    // Update state with round i's result (after betting on it).
    if (rule.type === "afterLosses") { const pt = PTS[byId[rule.point]]; lossRun = hits(crashes[i], pt) ? 0 : lossRun + 1; }
    if (needsWindow) PTS.forEach((p, j) => (cnt[j] += hits(crashes[i], p) - (i - W >= 0 ? hits(crashes[i - W], p) : 0)));
    if (i % every === 0) curve.push([i, profit]);
    if (onProgress && i % 100000 === 0) onProgress(i, N);
  }
  curve.push([N - 1, profit]);

  const next = decide(N);
  const sd = Math.sqrt(variance);
  return {
    rounds: N, bets, wins, hitRate: bets ? wins / bets : 0, staked, profit,
    returnPct: staked ? (100 * profit) / staked : 0,
    expectedPct: staked ? (100 * expected) / staked : 0,
    rangePct: staked ? [(100 * (expected - 1.96 * sd)) / staked, (100 * (expected + 1.96 * sd)) / staked] : [0, 0],
    maxDrawdown: maxDD, longestLoss, maxStake,
    busted: bustAt != null ? { atIndex: bustAt } : null,
    perPoint: [...perPoint.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.bets - a.bets),
    curve,
    next: next >= 0 ? { point: PTS[next].label, payout: PTS[next].payout, chance: PTS[next].p0 } : null,
  };
}

/** Preset rules for "Compare all". */
export const PRESETS = [
  { label: "Always 1.01×", rule: { type: "fixed", point: "1.01" } },
  { label: "Always 1.1×", rule: { type: "fixed", point: "1.1" } },
  { label: "Always 2×", rule: { type: "fixed", point: "2" } },
  { label: "Always 10×", rule: { type: "fixed", point: "10" } },
  { label: "Always 1.00× (instant bust)", rule: { type: "fixed", point: "bust" } },
  { label: "2× after 3 losses in a row", rule: { type: "afterLosses", point: "2", n: 3 } },
  { label: "10× after 20 losses in a row", rule: { type: "afterLosses", point: "10", n: 20 } },
  { label: "1.1× after a round below 1.05×", rule: { type: "afterLow", point: "1.1", y: 1.05 } },
  { label: "1.00× after a round below 1.01×", rule: { type: "afterLow", point: "bust", y: 1.01 } },
  { label: "Best ROI, last 2,000 rounds", rule: { type: "bestRoi", window: 2000 } },
  { label: "Best ROI, last 100 rounds", rule: { type: "bestRoi", window: 100 } },
  { label: "Most 'due' point, last 2,000 rounds", rule: { type: "due", window: 2000 } },
  { label: "Highest score, last 2,000 rounds", rule: { type: "bestScore", window: 2000 } },
  { label: "Random point", rule: { type: "random" } },
];
