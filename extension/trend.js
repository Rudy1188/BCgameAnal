// Trend ball panel, like bc.game's: red for 1.00×, orange below the payout point,
// green at or above it, yellow for big rounds (10× and up, still on the green side).
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
  return { bust: v("--bust", "#f0443b"), low: v("--low", "#ffad4d"), high: v("--high", "#24ee89"), big: v("--big", "#ebf005"),
           cell: v("--cell", "#1f2226"), bg: v("--layer", "#2b2f33") };
};

// Rounded square for each cell, like bc.game's trend.
function roundRect(ctx, x, y, s, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + s, y, x + s, y + s, r);
  ctx.arcTo(x + s, y + s, x, y + s, r);
  ctx.arcTo(x, y + s, x, y, r);
  ctx.arcTo(x, y, x + s, y, r);
  ctx.closePath();
}

/**
 * Like bc.game's trend: a rounded square per cell with a small dot (60% of the
 * square) inside. Dot colours: red 1.00×, orange below the payout point,
 * green at or above it, yellow 10× and up. `cols` columns are visible at once.
 * render({ crashes, n, point, big, roundId(i) })
 */
export function createTrendPanel(root, { rows = 10, cols: visibleCols = 30, cell = 18, gap = 2 } = {}) {
  let state = null;
  let L = null, Lkey = "", cellAt = null; // cellAt[col * rows + row] = round index or -1
  let follow = true; // keep the newest end in view
  const pitch = cell + gap;

  root.innerHTML = `<div class="tb-scroll"><div class="tb-inner"><canvas></canvas></div></div><div class="tb-tip" hidden></div>`;
  const $scroll = root.querySelector(".tb-scroll");
  const $inner = root.querySelector(".tb-inner");
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const $tip = root.querySelector(".tb-tip");
  const H = rows * pitch - gap;
  $inner.style.height = canvas.style.height = H + "px";
  $scroll.style.maxWidth = visibleCols * pitch - gap + "px";

  function relayout() {
    const { crashes, n, point } = state;
    const key = `${n}|${point}|${crashes.length}|${crashes[0]}|${crashes[n - 1]}`;
    if (key === Lkey) return;
    L = layoutBalls(crashes, n, point, rows);
    Lkey = key;
    cellAt = new Int32Array(L.cols * rows).fill(-1);
    for (let i = 0; i < n; i++) cellAt[L.col[i] * rows + L.row[i]] = i;
    $inner.style.width = Math.max(L.cols, visibleCols) * pitch - gap + "px";
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
    const c0 = Math.floor(left / pitch), c1 = Math.ceil((left + w) / pitch);

    // cells
    ctx.fillStyle = C.cell;
    ctx.beginPath();
    for (let c = c0; c < c1; c++) for (let r = 0; r < rows; r++) roundRect(ctx, c * pitch - left, r * pitch, cell, 4);
    ctx.fill();

    // dots
    const { crashes, point, big = 10 } = state;
    const rad = (cell * 0.6) / 2;
    for (let c = c0; c < Math.min(c1, L.cols); c++) {
      for (let r = 0; r < rows; r++) {
        const i = cellAt[c * rows + r];
        if (i < 0) continue;
        const x = crashes[i];
        ctx.fillStyle = x <= 1 ? C.bust : x < point ? C.low : x >= big ? C.big : C.high;
        ctx.beginPath();
        ctx.arc(c * pitch - left + cell / 2, r * pitch + cell / 2, rad, 0, Math.PI * 2);
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
    follow = $scroll.scrollLeft + $scroll.clientWidth >= $scroll.scrollWidth - pitch;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  });
  // Mouse wheel scrolls sideways.
  $scroll.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $scroll.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const c = Math.floor((x + $scroll.scrollLeft) / pitch), r = Math.floor(y / pitch);
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
  .tb-scroll { margin:0 auto; overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; scrollbar-color:#454b52 transparent; padding-bottom:4px; }
  .tb-inner { position:relative; min-width:100%; }
  .tb-inner canvas { position:sticky; left:0; display:block; }
  .tb-tip { position:absolute; pointer-events:none; background:#000d; color:#fff; font-size:11px; padding:3px 7px; border-radius:4px; white-space:nowrap; z-index:2; }
`;
