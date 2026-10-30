// Trend ball panel, like bc.game's: red below the payout point, green at or
// above it, yellow for big rounds (10× and up, still on the green side).
// Each streak fills a column top to bottom; a streak longer than the 6 rows
// turns right along the bottom (L-shape) instead of starting a new column.
// The board is split into pages that fit the panel width; the last page is
// the newest.

const fmt = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";

/**
 * Lays out rounds oldest-first. crashes: newest first; uses the first n.
 * Returns { col: Int32Array, row: Uint8Array, cols } indexed by round index i (0 = newest).
 */
export function layoutBalls(crashes, n, point, rows = 6) {
  const col = new Int32Array(n);
  const row = new Uint8Array(n);
  let occ = new Uint8Array(1024); // bitmask of filled rows per column
  const mark = (c, r) => {
    if (c >= occ.length) { const o = new Uint8Array(Math.max(c + 1, occ.length * 2)); o.set(occ); occ = o; }
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

/**
 * opts: rows (6), cell (px per ball), onPick(i) when a ball is clicked.
 * render({ crashes, n, point, big, roundId(i), marks: Map(i -> class) })
 */
export function createTrendPanel(root, { rows = 6, cell = 20, onPick } = {}) {
  let fromNewest = 0; // pages back from the newest page
  let state = null;
  let L = null, Lkey = "";

  root.innerHTML = `
    <div class="tb-board"><div class="tb-grid"></div></div>
    <div class="tb-pager">
      <button data-go="first" title="Oldest page">«</button>
      <button data-go="prev" title="Older">‹</button>
      <span class="tb-page"><input type="number" min="1" value="1"> / <b>1</b></span>
      <button data-go="next" title="Newer">›</button>
      <button data-go="last" title="Newest page">»</button>
    </div>
    <div class="tb-range"></div>`;
  const $board = root.querySelector(".tb-board");
  const $grid = root.querySelector(".tb-grid");
  const $page = root.querySelector(".tb-page input");
  const $pages = root.querySelector(".tb-page b");
  const $range = root.querySelector(".tb-range");

  const perPage = () => Math.max(5, Math.floor(($board.clientWidth || root.clientWidth || 340) / cell));

  function draw() {
    if (!state) return;
    const { crashes, n, point, big = 10, roundId, marks = new Map() } = state;
    const key = `${n}|${point}|${crashes.length}|${crashes[0]}|${crashes[n - 1]}`;
    if (key !== Lkey) { L = layoutBalls(crashes, n, point, rows); Lkey = key; }

    const V = perPage();
    const pages = Math.max(1, Math.ceil(L.cols / V));
    fromNewest = Math.max(0, Math.min(fromNewest, pages - 1));
    const last = L.cols - fromNewest * V; // exclusive
    const first = Math.max(0, last - V);

    $grid.style.width = V * cell + "px";
    $grid.style.height = rows * cell + "px";
    $grid.style.backgroundSize = `${cell}px ${cell}px`;
    const size = cell - 4;
    let html = "", newest = -1, oldest = -1;
    for (let i = 0; i < n; i++) {
      const c = L.col[i];
      if (c < first || c >= last) continue;
      if (newest < 0) newest = i;
      oldest = i;
      const x = crashes[i];
      const tone = x < point ? "lo" : x >= big ? "bg" : "hi";
      const m = marks.get(i);
      const id = roundId(i);
      html += `<span class="tb-ball ${tone}${m ? " " + m : ""}" data-i="${i}" title="${id != null ? "Round " + id + " · " : ""}${fmt(x)}"` +
        ` style="left:${(c - first) * cell + 2}px;top:${L.row[i] * cell + 2}px;width:${size}px;height:${size}px"></span>`;
    }
    $grid.innerHTML = html;
    $page.max = String(pages);
    $page.value = String(pages - fromNewest);
    $pages.textContent = pages.toLocaleString();
    root.querySelector('[data-go="first"]').disabled = root.querySelector('[data-go="prev"]').disabled = fromNewest >= pages - 1;
    root.querySelector('[data-go="last"]').disabled = root.querySelector('[data-go="next"]').disabled = fromNewest === 0;
    const rid = (i) => roundId(i) ?? `#${i + 1}`;
    $range.textContent = n ? `Rounds ${rid(oldest)} → ${rid(newest)}${fromNewest === 0 ? " (newest)" : ""}` : "";
  }

  root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
    const go = b.dataset.go;
    fromNewest = go === "last" ? 0 : go === "first" ? Infinity : go === "prev" ? fromNewest + 1 : fromNewest - 1;
    draw();
  }));
  $page.onchange = () => {
    const pages = Number($page.max) || 1;
    const p = Math.round(Number($page.value));
    if (p >= 1) { fromNewest = pages - Math.min(p, pages); }
    draw();
  };
  $grid.onclick = (e) => {
    const i = Number(e.target.closest("[data-i]")?.dataset.i);
    if (Number.isInteger(i)) onPick?.(i);
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => draw()).observe($board);

  return {
    render(s) { state = s; draw(); },
    /** Show the page holding round index i. */
    focus(i) {
      if (!L || i >= L.col.length) return;
      const V = perPage();
      const pages = Math.max(1, Math.ceil(L.cols / V));
      // Pages are counted from the newest end, matching draw().
      fromNewest = Math.min(pages - 1, Math.floor((L.cols - 1 - L.col[i]) / V));
      draw();
    },
  };
}

export const TREND_CSS = `
  .tb-board { overflow:hidden; }
  .tb-grid { position:relative; margin:0 auto; border-radius:6px; background-color:var(--bg);
    background-image:linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px); }
  .tb-ball { position:absolute; border-radius:50%; cursor:pointer; box-shadow:inset 0 -2px 3px #0005, inset 0 2px 2px #fff3; }
  .tb-ball.lo { background:var(--low); } .tb-ball.hi { background:var(--high); } .tb-ball.bg { background:var(--big); }
  .tb-ball.max { outline:2px solid #fff; outline-offset:1px; }
  .tb-ball.pick { outline:2px solid var(--accent); outline-offset:1px; animation:tbpulse 1s ease-in-out 3; }
  @keyframes tbpulse { 50% { transform:scale(1.35); } }
  .tb-pager { display:flex; justify-content:center; align-items:center; gap:4px; margin-top:8px; color:var(--muted); font-size:12px; }
  .tb-pager button { min-width:30px; padding:3px 0; }
  .tb-pager button:disabled { opacity:.35; cursor:default; }
  .tb-page input { width:64px; text-align:center; padding:3px 4px; font:12px system-ui, sans-serif; }
  .tb-range { text-align:center; color:var(--muted); font-size:11px; margin-top:4px; }
`;
