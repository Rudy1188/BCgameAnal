// Trend panel: "Beads" (bc.game-style dot grid, one column per streak) and
// "Chart" (multiplier bars + share of rounds at/above the payout point).
// Drawn on a canvas so it stays fast with millions of rounds; a slider pans
// back through history (right end = newest).

const COLORS = () => {
  const s = getComputedStyle(document.documentElement);
  const v = (n, d) => s.getPropertyValue(n).trim() || d;
  return { low: v("--low", "#ff6b6b"), high: v("--high", "#4fd18b"), big: v("--big", "#f5c451"),
           line: v("--line", "#2a2f3a"), muted: v("--muted", "#8a91a3"), text: v("--text", "#e6e8ee"), accent: v("--accent", "#4f8cff") };
};
const ZOOMS = [100, 500, 2000, 10000, 100000, 1000000];
const fmt = (x) => x.toFixed(2) + "×";

/**
 * opts: getCrashes() newest-first, getRoundId(i), getPoint(), getCount(),
 *       views (["beads","chart"]), height, cell (bead size), rows (bead rows)
 */
export function createTrendPanel(root, opts) {
  const { getCrashes, getRoundId, getPoint, getCount, views = ["beads", "chart"], height = 200, cell = 16, rows = 6 } = opts;
  let view = views[0];
  let zoom = 500;
  let offset = 0; // columns (beads) or rounds (chart) back from the newest end
  let layout = null; // cached bead columns
  let layoutKey = "";

  root.innerHTML = `
    <div class="tr-head">
      ${views.length > 1 ? views.map((v) => `<button data-view="${v}">${v === "beads" ? "Beads" : "Chart"}</button>`).join("") : ""}
      <select class="tr-zoom" title="Rounds on screen">${ZOOMS.map((z) => `<option value="${z}">${z.toLocaleString()} rounds on screen</option>`).join("")}</select>
      <span class="tr-range"></span>
    </div>
    <div class="tr-canvaswrap"><canvas></canvas><div class="tr-tip" hidden></div></div>
    <input class="tr-pan" type="range" min="0" max="0" value="0" title="Drag left to go back in history">
    <div class="tr-legend"></div>`;

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const $pan = root.querySelector(".tr-pan");
  const $zoom = root.querySelector(".tr-zoom");
  const $range = root.querySelector(".tr-range");
  const $tip = root.querySelector(".tr-tip");
  const $legend = root.querySelector(".tr-legend");
  canvas.style.height = height + "px";

  // ---- Beads layout: one column per streak, wrapping after `rows` ----
  function getLayout(crashes, n, point) {
    const key = `${n}|${point}|${crashes.length}|${crashes[0]}|${crashes[n - 1]}`;
    if (key === layoutKey) return layout;
    const start = new Int32Array(Math.max(16, Math.ceil(n / 1) + 1));
    const len = new Uint8Array(start.length);
    const below = new Uint8Array(start.length);
    let cols = 0;
    let i = n - 1; // oldest first
    while (i >= 0) {
      const b = crashes[i] < point;
      let s = i;
      while (i >= 0 && (crashes[i] < point) === b) i--;
      let remaining = s - i;
      while (remaining > 0) {
        const l = Math.min(rows, remaining);
        start[cols] = s; len[cols] = l; below[cols] = b ? 1 : 0; cols++;
        s -= l; remaining -= l;
      }
    }
    layout = { start, len, below, cols };
    layoutKey = key;
    return layout;
  }

  function size() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, canvas.clientWidth || root.clientWidth || 400);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return w;
  }

  // Slider value is "how far from the oldest end"; offset is "how far back from newest".
  function setPan(max) {
    $pan.max = String(max);
    offset = Math.min(offset, max);
    $pan.value = String(max - offset);
    $pan.disabled = max === 0;
  }

  let hit = null; // for hover: maps x,y to a round index

  function draw() {
    const C = COLORS();
    const w = size();
    ctx.clearRect(0, 0, w, height);
    const crashes = getCrashes();
    const n = Math.min(getCount(), crashes.length);
    const point = getPoint();
    root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $zoom.hidden = view !== "chart";
    if (!n) { $range.textContent = ""; $legend.textContent = ""; setPan(0); hit = null; return; }

    const rid = (i) => { const r = getRoundId(i); return r != null ? r : `#${i + 1}`; };

    if (view === "beads") {
      const L = getLayout(crashes, n, point);
      const c = Math.max(6, Math.min(cell, Math.floor(height / rows)));
      const visible = Math.max(1, Math.floor(w / c));
      setPan(Math.max(0, L.cols - visible));
      const last = L.cols - offset; // exclusive
      const first = Math.max(0, last - visible);
      const r = c / 2 - 1.5;
      for (let col = first; col < last; col++) {
        const x = (col - first) * c + c / 2;
        ctx.fillStyle = L.below[col] ? C.low : C.high;
        for (let k = 0; k < L.len[col]; k++) {
          ctx.beginPath();
          ctx.arc(x, k * c + c / 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      hit = (x, y) => {
        const col = first + Math.floor(x / c), k = Math.floor(y / c);
        if (col >= last || k >= (L.len[col] ?? 0)) return -1;
        return L.start[col] - k;
      };
      const newest = L.start[last - 1] - L.len[last - 1] + 1, oldest = L.start[first];
      $range.textContent = `Rounds ${rid(oldest)} → ${rid(newest)} · ${L.cols.toLocaleString()} columns`;
      $legend.innerHTML = `<span class="lo">●</span> below ${point}× &nbsp; <span class="hi">●</span> ${point}× and up &nbsp; · one column per streak`;
      return;
    }

    // ---- Chart ----
    const R = Math.min(zoom, n);
    setPan(Math.max(0, n - R));
    const newest = offset, oldest = offset + R - 1; // indexes (0 = newest)
    const top = 8, bottom = height - 16, plotH = bottom - top;
    let maxX = 2;
    for (let i = newest; i <= oldest; i++) if (crashes[i] > maxX) maxX = crashes[i];
    const capY = Math.min(Math.max(10, maxX), 10000);
    const y = (x) => bottom - (Math.log(Math.min(x, capY)) / Math.log(capY)) * plotH;

    // Grid
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = C.muted;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    for (const g of [1, 2, 5, 10, 100, 1000, 10000]) {
      if (g > capY) break;
      ctx.beginPath(); ctx.moveTo(0, y(g) + 0.5); ctx.lineTo(w, y(g) + 0.5); ctx.stroke();
      ctx.fillText(g + "×", 2, y(g) - 2);
    }

    const perPx = R / w;
    const grouped = perPx >= 2; // otherwise draw every round
    const color = (x) => (x >= 10 ? C.big : x >= point ? C.high : C.low);
    const rate = []; // share at/above point per x, for the line
    if (!grouped) {
      const bw = w / R;
      for (let j = 0; j < R; j++) {
        const i = oldest - j; // left = oldest
        const x = crashes[i];
        ctx.fillStyle = color(x);
        ctx.fillRect(j * bw + (bw > 3 ? 0.5 : 0), y(x), Math.max(1, bw - (bw > 3 ? 1 : 0)), bottom - y(x) || 1);
        // rolling share over the previous 50 rounds
        let a = 0, m = 0;
        for (let k = i; k < Math.min(i + 50, n); k++, m++) if (crashes[k] >= point) a++;
        rate.push([j * bw + bw / 2, a / m]);
      }
      hit = (px) => { const j = Math.floor(px / bw); return j >= 0 && j < R ? oldest - j : -1; };
    } else {
      for (let px = 0; px < w; px++) {
        const a0 = oldest - Math.floor(px * perPx), a1 = Math.max(newest, oldest - Math.floor((px + 1) * perPx) + 1);
        let mx = 0, up = 0, cnt = 0;
        for (let i = a0; i >= a1; i--) { const x = crashes[i]; if (x > mx) mx = x; if (x >= point) up++; cnt++; }
        if (!cnt) continue;
        ctx.fillStyle = color(mx);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(px, y(mx), 1, bottom - y(mx));
        ctx.globalAlpha = 1;
        rate.push([px + 0.5, up / cnt]);
      }
      hit = (px) => { const i = oldest - Math.floor(px * perPx); return i >= newest && i <= oldest ? i : -1; };
    }

    // Payout point line
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C.text;
    ctx.beginPath(); ctx.moveTo(0, y(point) + 0.5); ctx.lineTo(w, y(point) + 0.5); ctx.stroke();
    ctx.setLineDash([]);

    // Share-at-or-above line (0% bottom, 100% top)
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    rate.forEach(([x, r], k) => (k ? ctx.lineTo(x, bottom - r * plotH) : ctx.moveTo(x, bottom - r * plotH)));
    ctx.stroke();
    ctx.lineWidth = 1;

    $range.textContent = `Rounds ${rid(oldest)} → ${rid(newest)}`;
    $legend.innerHTML = `Bars: multiplier (log scale)${grouped ? `, highest per ${Math.round(perPx).toLocaleString()} rounds` : ""} · dashed: ${point}× · ` +
      `<span style="color:var(--accent)">line</span>: share of rounds at or above ${point}× (${grouped ? "per bar" : "last 50"}, 0–100%)`;
  }

  // Hover tooltip
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const i = hit ? hit(e.clientX - rect.left, e.clientY - rect.top) : -1;
    const crashes = getCrashes();
    if (i < 0 || i >= crashes.length) { $tip.hidden = true; return; }
    const r = getRoundId(i);
    $tip.textContent = `${r != null ? "Round " + r : "#" + (i + 1)}: ${fmt(crashes[i])}`;
    $tip.hidden = false;
    $tip.style.left = Math.min(e.clientX - rect.left + 10, rect.width - 130) + "px";
    $tip.style.top = Math.max(0, e.clientY - rect.top - 28) + "px";
  });
  canvas.addEventListener("mouseleave", () => ($tip.hidden = true));

  $pan.oninput = () => { offset = Number($pan.max) - Number($pan.value); draw(); };
  $zoom.value = String(zoom);
  $zoom.onchange = () => { zoom = Number($zoom.value); offset = 0; draw(); };
  root.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { view = b.dataset.view; offset = 0; draw(); }));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => draw()).observe(root);

  draw();
  return { render: draw };
}

export const TREND_CSS = `
  .tr-head { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
  .tr-head button { font:inherit; font-size:12px; color:var(--text); background:#252a35; border:1px solid var(--line); border-radius:5px; padding:3px 10px; cursor:pointer; }
  .tr-head button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .tr-head select { font:inherit; font-size:12px; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:3px 6px; }
  .tr-range { margin-left:auto; color:var(--muted); font-size:11px; }
  .tr-canvaswrap { position:relative; }
  .tr-canvaswrap canvas { display:block; width:100%; background:var(--bg); border-radius:6px; }
  .tr-tip { position:absolute; pointer-events:none; background:#000c; color:#fff; font-size:11px; padding:3px 7px; border-radius:4px; white-space:nowrap; }
  .tr-pan { width:100%; margin:8px 0 2px; accent-color:var(--accent); }
  .tr-legend { color:var(--muted); font-size:11px; }
`;
