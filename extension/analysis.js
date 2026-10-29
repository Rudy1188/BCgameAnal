// "Last N rounds, payout < X" analysis, like bc.game's own stats table.

export const COUNTS_POPUP = [100, 500, 1000, 2000, 5000, 10000, 50000];
export const COUNTS_FULL = [100, 500, 1000, 2000, 5000, 10000, 50000, 100000, 500000, 1000000, 2000000, 5000000];
export const POINTS = [1.3, 1.5, 2, 3, 5, 10, 20, 50, 100];
export const DEFAULT_COUNT = 2000;

/**
 * crashes: newest first (array or Float64Array). Splits the last `n` rounds
 * into [1, point) and [point, ∞): count, chance, longest streak, current streak.
 */
export function analyze(crashes, n, point) {
  const len = Math.min(n, crashes.length);
  let below = 0, run = 0, runBelow = false, maxBelow = 0, maxAbove = 0;
  for (let i = 0; i < len; i++) {
    const isBelow = crashes[i] < point;
    if (isBelow) below++;
    if (i > 0 && isBelow === runBelow) run++;
    else { run = 1; runBelow = isBelow; }
    if (isBelow) { if (run > maxBelow) maxBelow = run; }
    else if (run > maxAbove) maxAbove = run;
  }
  // Current streak = the run at the newest end.
  let current = 0;
  const firstBelow = len ? crashes[0] < point : false;
  while (current < len && (crashes[current] < point) === firstBelow) current++;
  const above = len - below;
  const pct = (c) => (len ? (100 * c) / len : 0);
  return {
    total: len,
    sides: [
      { label: `[1, ${point})`, count: below, chance: pct(below), maxCombo: maxBelow, current: len && firstBelow ? current : 0, cls: "lo" },
      { label: `[${point}, ∞)`, count: above, chance: pct(above), maxCombo: maxAbove, current: len && !firstBelow ? current : 0, cls: "hi" },
    ],
  };
}

const short = (n) => (n >= 1e6 ? n / 1e6 + "M" : n >= 1e3 ? n / 1e3 + "K" : String(n));

/**
 * Builds the analysis panel inside `root`.
 * getCrashes() returns the crash points, newest first (may be shorter than N while calculating).
 * onChange({count, point}) is called whenever the selection changes.
 */
export function createAnalysisPanel(root, getCrashes, { counts = COUNTS_FULL, storageKey = "analysis", onChange } = {}) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch {}
  let count = counts.includes(saved.count) ? saved.count : DEFAULT_COUNT;
  let point = saved.point > 1 ? saved.point : 2;
  let progress = "";

  root.innerHTML = `
    <div class="an-head">
      <span>Last</span>
      <select class="an-count">${counts.map((c) => `<option value="${c}">${c.toLocaleString()} (${short(c)})</option>`).join("")}</select>
      <span>rounds, payout &lt;</span>
      <input class="an-point" type="number" min="1.01" step="0.01">
    </div>
    <div class="an-points">${POINTS.map((p) => `<button data-p="${p}">${p}×</button>`).join("")}</div>
    <table class="an-table">
      <thead><tr><th>Range</th><th>Chance</th><th>Count</th><th>Max Combo</th><th>Current</th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="an-note"></div>`;

  const $c = root.querySelector(".an-count");
  const $p = root.querySelector(".an-point");
  const $body = root.querySelector("tbody");
  const $note = root.querySelector(".an-note");

  function render(changed = false) {
    $c.value = String(count);
    $p.value = String(point);
    root.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("on", Number(b.dataset.p) === point));
    try { localStorage.setItem(storageKey, JSON.stringify({ count, point })); } catch {}

    const crashes = getCrashes();
    if (!crashes.length) {
      $body.innerHTML = "";
      $note.textContent = progress || "No rounds yet.";
    } else {
      const { total, sides } = analyze(crashes, count, point);
      $body.innerHTML = sides.map((s) =>
        `<tr><td class="${s.cls}">${s.label}</td><td>${s.chance.toFixed(2)}%</td><td>${s.count.toLocaleString()}</td><td>${s.maxCombo}</td><td>${s.current}</td></tr>`
      ).join("");
      $note.textContent = total < count ? progress || `Only ${total.toLocaleString()} rounds calculated so far.` : "";
    }
    if (changed) onChange?.({ count, point });
  }

  $c.onchange = () => { count = Number($c.value); render(true); };
  $p.onchange = () => {
    const v = Number($p.value);
    if (v > 1) { point = Math.round(v * 100) / 100; render(true); }
  };
  root.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { point = Number(b.dataset.p); render(true); }));

  render();
  return {
    render,
    setProgress(text) { progress = text; render(); },
    get count() { return count; },
    get point() { return point; },
  };
}

export const ANALYSIS_CSS = `
  .an-head { display:flex; gap:6px; align-items:center; flex-wrap:wrap; color:var(--muted); }
  .an-head select, .an-head input { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:4px 6px; }
  .an-head input { width:80px; }
  .an-points { display:flex; gap:4px; flex-wrap:wrap; margin:8px 0; }
  .an-points button { font:inherit; font-size:12px; color:var(--text); background:#252a35; border:1px solid var(--line); border-radius:5px; padding:3px 9px; cursor:pointer; }
  .an-points button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .an-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  .an-table th, .an-table td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); }
  .an-table th { color:var(--muted); font-weight:500; font-size:11px; }
  .an-table td:first-child { font-weight:700; }
  .an-note { color:var(--muted); font-size:11px; margin-top:4px; }
  .an-note:empty { display:none; }
`;
