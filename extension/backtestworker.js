// Runs strategy backtests off the main thread.
import { backtest, PRESETS } from "./backtest.js";

self.onmessage = ({ data }) => {
  try {
    const { cmd, crashes, rule, staking, opts } = data;
    if (cmd === "run") {
      const result = backtest(crashes, rule, staking, { ...opts, onProgress: (i, n) => self.postMessage({ progress: `Testing ${Math.round((100 * i) / n)}%…` }) });
      self.postMessage({ done: true, result });
    } else if (cmd === "compare") {
      const rows = [];
      PRESETS.forEach((p, i) => {
        self.postMessage({ progress: `Testing ${i + 1} / ${PRESETS.length}: ${p.label}…` });
        const r = backtest(crashes, p.rule, staking, { ...opts, curvePoints: 2 });
        rows.push({ label: p.label, rule: p.rule, bets: r.bets, returnPct: r.returnPct, rangePct: r.rangePct, expectedPct: r.expectedPct, profit: r.profit, longestLoss: r.longestLoss, maxDrawdown: r.maxDrawdown, busted: r.busted, next: r.next });
      });
      self.postMessage({ done: true, rows });
    }
  } catch (e) {
    self.postMessage({ error: String(e?.stack || e) });
  }
};
