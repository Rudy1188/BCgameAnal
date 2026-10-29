// "Last N rounds, payout < X" analysis, like bc.game's own stats table.

export const COUNTS = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];
export const POINTS = [1.3, 1.5, 2, 3, 5, 10, 20, 50, 100];

/**
 * crashes: newest first. Splits the last `n` rounds into [1, point) and [point, ∞).
 * For each side: count, chance, longest streak (max combo) and current streak.
 */
export function analyze(crashes, n, point) {
  const xs = crashes.slice(0, n);
  const sides = [
    { label: `[1, ${point})`, test: (x) => x < point, count: 0, maxCombo: 0, current: 0, cls: "lo" },
    { label: `[${point}, ∞)`, test: (x) => x >= point, count: 0, maxCombo: 0, current: 0, cls: "hi" },
  ];
  for (const s of sides) {
    let run = 0;
    for (const x of xs) {
      if (s.test(x)) { s.count++; run++; if (run > s.maxCombo) s.maxCombo = run; }
      else run = 0;
    }
    // Current streak = run at the newest end.
    let cur = 0;
    for (const x of xs) { if (s.test(x)) cur++; else break; }
    s.current = cur;
    s.chance = xs.length ? (100 * s.count) / xs.length : 0;
  }
  return { total: xs.length, sides };
}

/**
 * Builds the analysis panel inside `root`.
 * getCrashes() returns the crash points, newest first (may be shorter than N).
 */
export function createAnalysisPanel(root, getCrashes, { defaultCount = 2000, defaultPoint = 2, storageKey = "analysis", onChange } = {}) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch {}
  let count = saved.count ?? defaultCount;
  let point = saved.point ?? defaultPoint;

  root.innerHTML = `
    <div class="an-head">
      <span>Last</span>
      <select class="an-count">${COUNTS.map((c) => `<option value="${c}">${c.toLocaleString()}</option>`).join("")}</select>
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

  function render() {
    $c.value = String(count);
    $p.value = String(point);
    root.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("on", Number(b.dataset.p) === point));
    try { localStorage.setItem(storageKey, JSON.stringify({ count, point })); } catch {}

    const crashes = getCrashes();
    if (!crashes.length) { $body.innerHTML = ""; $note.textContent = "No rounds yet."; return; }
    const { total, sides } = analyze(crashes, count, point);
    $body.innerHTML = sides.map((s) =>
      `<tr><td class="${s.cls}">${s.label}</td><td>${s.chance.toFixed(2)}%</td><td>${s.count.toLocaleString()}</td><td>${s.maxCombo}</td><td>${s.current}</td></tr>`
    ).join("");
    $note.textContent = total < count ? `Only ${total.toLocaleString()} rounds calculated so far.` : "";
    onChange?.({ count, point });
  }

  $c.onchange = () => { count = Number($c.value); render(); };
  $p.onchange = () => {
    const v = Number($p.value);
    if (v > 1) { point = Math.round(v * 100) / 100; render(); }
  };
  root.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { point = Number(b.dataset.p); render(); }));

  render();
  return { render, get count() { return count; }, get point() { return point; } };
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
