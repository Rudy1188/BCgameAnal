// "Last N issue, payout < X" stats like bc.game's table, plus the biggest crashes.

export const MAX_COUNT = 100000;
export const DEFAULT_COUNT = 2000;
export const COUNTS = [100, 500, 2000, 10000, 100000];
export const POINTS = [1.5, 2, 3, 5, 10];

/**
 * crashes: newest first. Splits the last n rounds into [1, point) and [point, ∞):
 * chance, count, and longest run in a row (Max Combo).
 */
export function analyze(crashes, n, point) {
  const len = Math.min(n, crashes.length);
  let below = 0, run = 0, runBelow = false, maxBelow = 0, maxAbove = 0;
  for (let i = 0; i < len; i++) {
    const isBelow = crashes[i] < point;
    if (isBelow) below++;
    if (i > 0 && isBelow === runBelow) run++;
    else { run = 1; runBelow = isBelow; }
    if (isBelow) { if (run > maxBelow) maxBelow = run; } else if (run > maxAbove) maxAbove = run;
  }
  const above = len - below;
  const pct = (c) => (len ? (100 * c) / len : 0);
  return {
    total: len,
    sides: [
      { label: `[1, ${point})`, count: below, chance: pct(below), maxCombo: maxBelow, cls: "lo" },
      { label: `[${point}, ∞)`, count: above, chance: pct(above), maxCombo: maxAbove, cls: "hi" },
    ],
  };
}

/** The k biggest crashes in the last n rounds: [{ i, x }], biggest first. */
export function biggest(crashes, n, k = 10) {
  const len = Math.min(n, crashes.length);
  const top = [];
  for (let i = 0; i < len; i++) {
    const x = crashes[i];
    if (top.length === k && x <= top[k - 1].x) continue;
    let j = Math.min(top.length, k - 1);
    top[j] = { i, x };
    while (j > 0 && top[j - 1].x < x) { [top[j - 1], top[j]] = [top[j], top[j - 1]]; j--; }
  }
  return top;
}
