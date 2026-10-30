// Trend ball panel, like bc.game's: orange below the payout point, green at or
// above it, yellow for big rounds (10× and up, still on the green side).
// Each streak fills a column top to bottom; a streak longer than the rows
// turns right along the bottom (L-shape) instead of starting a new column.
// The board scrolls sideways (newest on the right) and is drawn on a canvas,
// only the visible part, so 100,000 rounds stay fast.

const fmt = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";

/**
 * Lays out rounds oldest-first. crashes: newest first; uses the first n.
 * Returns { col: Int32Array, row: Uint8Array, cols } indexed by round index i (0 = newest).
 */
export function layoutBalls(crashes, n, point, rows = 10) {
  const col = new Int32Array(n);
  const row = new Uint8Array(n);
  let occ = new Uint16Array(1024); // bitmask of filled rows per column
  const mark = (c, r) => {
    if (c >= occ.length) { const o = new Uint16Array(Math.max(c + 1, occ.length * 2)); o.set(occ); occ = o; }
    occ[c] |= 1 << r;
  };
  const filled = (c, r) => c < occ.length && (occ[c] >> r) & 1;
  let start = -1, c = 0, r = 0, side = null, cols = 0;
  for (let i = n - 1; i >= 0; i--) {
    const below = crashes[i] < point;
    if (below !== side) {
      side = below;
      start++;
      while (filled(start, 0)) start++;
      c = start; r = 0;
    } else if (r + 1 < rows && !filled(c, r + 1)) {
      r++;
    } else {
      c++; // L-shape: continue to the right on the same row
    }
    mark(c, r);
    col[i] = c; row[i] = r;
    if (c + 1 > cols) cols = c + 1;
  }
  return { col, row, cols };
}

const colors = () => {
  const s = getComputedStyle(document.documentElement);
  const v = (n, d) => s.getPropertyValue(n).trim() || d;
  return { low: v("--low", "#ff7a1a"), high: v("--high", "#3bc117"), big: v("--big", "#f5c451"), grid: v("--grid", "#222733"), bg: v("--bg", "#0f1115") };
};

/** render({ crashes, n, point, big, roundId(i) }) */
export function createTrendPanel(root, { rows = 10, cell = 20 } = {}) {
  let state = null;
  let L = null, Lkey = "", cellAt = null; // cellAt[col * rows + row] = round index or -1
  let follow = true; // keep the newest end in view

  root.innerHTML = `<div class="tb-scroll"><div class="tb-inner"><canvas></canvas></div></div><div class="tb-tip" hidden></div>`;
  const $scroll = root.querySelector(".tb-scroll");
  const $inner = root.querySelector(".tb-inner");
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const $tip = root.querySelector(".tb-tip");
  const H = rows * cell;
  $inner.style.height = canvas.style.height = H + "px";

  function relayout() {
    const { crashes, n, point } = state;
    const key = `${n}|${point}|${crashes.length}|${crashes[0]}|${crashes[n - 1]}`;
    if (key === Lkey) return;
    L = layoutBalls(crashes, n, point, rows);
    Lkey = key;
    cellAt = new Int32Array(L.cols * rows).fill(-1);
    for (let i = 0; i < n; i++) cellAt[L.col[i] * rows + L.row[i]] = i;
    $inner.style.width = L.cols * cell + "px";
  }

  function draw() {
    if (!state || !L) return;
    const C = colors();
    const w = $scroll.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = w + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, H);
    const left = $scroll.scrollLeft;
    const c0 = Math.floor(left / cell), c1 = Math.min(L.cols, Math.ceil((left + w) / cell));
    const dx = -left;

    // grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = c0; c <= Math.max(c1, c0 + Math.ceil(w / cell)); c++) { const x = Math.round(c * cell + dx) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let r = 0; r <= rows; r++) { const y = Math.min(H - 0.5, r * cell + 0.5); ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // balls
    const { crashes, point, big = 10 } = state;
    const rad = cell / 2 - 2;
    for (let c = c0; c < c1; c++) {
      for (let r = 0; r < rows; r++) {
        const i = cellAt[c * rows + r];
        if (i < 0) continue;
        const x = crashes[i];
        const cx = c * cell + dx + cell / 2, cy = r * cell + cell / 2;
        ctx.fillStyle = x < point ? C.low : x >= big ? C.big : C.high;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function render(s) {
    state = s;
    relayout();
    // Stay at the newest end unless the user scrolled back.
    if (follow) $scroll.scrollLeft = $scroll.scrollWidth;
    draw();
  }

  let raf = 0;
  $scroll.addEventListener("scroll", () => {
    $tip.hidden = true;
    follow = $scroll.scrollLeft + $scroll.clientWidth >= $scroll.scrollWidth - cell;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  });
  // Mouse wheel scrolls sideways.
  $scroll.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $scroll.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const c = Math.floor((x + $scroll.scrollLeft) / cell), r = Math.floor(y / cell);
    const i = L && c >= 0 && c < L.cols && r >= 0 && r < rows ? cellAt[c * rows + r] : -1;
    if (i < 0) { $tip.hidden = true; return; }
    const id = state.roundId(i);
    $tip.textContent = `${id != null ? "Round " + id + " · " : ""}${fmt(state.crashes[i])}`;
    $tip.hidden = false;
    $tip.style.left = Math.max(0, Math.min(x + 10, rect.width - 150)) + "px";
    $tip.style.top = Math.max(0, y - 26) + "px";
  });
  canvas.addEventListener("mouseleave", () => ($tip.hidden = true));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (follow) $scroll.scrollLeft = $scroll.scrollWidth; draw(); }).observe($scroll);

  return { render };
}

export const TREND_CSS = `
  #trend { position:relative; }
  .tb-scroll { overflow-x:auto; overflow-y:hidden; border-radius:6px; background:var(--bg); scrollbar-color:#3a4150 transparent; }
  .tb-inner { position:relative; min-width:100%; }
  .tb-inner canvas { position:sticky; left:0; display:block; }
  .tb-tip { position:absolute; pointer-events:none; background:#000d; color:#fff; font-size:11px; padding:3px 7px; border-radius:4px; white-space:nowrap; z-index:2; }
`;
