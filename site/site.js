// Demo trend board for the home page. Uses sample rounds with the same odds as Crash.
(() => {
  const board = document.getElementById("board");
  if (!board) return;
  const ROWS = 8, KEEP = 2000;
  const results = [];

  const crash = () => {
    const x = Math.random();
    return Math.max(1, Math.floor(99 / (1 - x)) / 100);
  };
  const kind = (v) => v >= 100 ? "huge" : v >= 10 ? "big" : v >= 2 ? "high" : v <= 1 ? "bust" : "low";

  // Streak layout: fill a column downwards, turn right along the row when blocked.
  function layout(list) {
    const taken = new Set(), cells = [];
    let col = -1, row = 0, start = -1, prevHigh = null;
    for (const v of list) {
      const high = v >= 2;
      if (high !== prevHigh) {
        start += 1; col = start; row = 0;
      } else if (row + 1 < ROWS && !taken.has(col + "," + (row + 1))) {
        row += 1;
      } else {
        col += 1;
      }
      taken.add(col + "," + row);
      cells.push({ col, row, v });
      prevHigh = high;
    }
    return cells;
  }

  function maxRun(list, test) {
    let best = 0, run = 0;
    for (const v of list) { run = test(v) ? run + 1 : 0; if (run > best) best = run; }
    return best;
  }

  function render(fresh) {
    const style = getComputedStyle(board);
    const cell = parseFloat(style.getPropertyValue("--c")) || 18;
    const gap = parseFloat(style.columnGap) || 3;
    const cols = Math.max(8, Math.floor((board.clientWidth + gap) / (cell + gap)));

    const cells = layout(results.slice(-cols * ROWS));
    const last = cells.length ? cells[cells.length - 1].col : 0;
    const first = Math.max(0, last - cols + 1);
    const grid = Array.from({ length: cols * ROWS }, () => null);
    cells.forEach((c, i) => {
      if (c.col < first) return;
      grid[(c.col - first) * ROWS + c.row] = { v: c.v, isNew: fresh && i === cells.length - 1 };
    });

    board.innerHTML = grid.map((g) => g
      ? `<b class="k-${kind(g.v)}${g.isNew ? " new" : ""}" title="${g.v.toFixed(2)}×"></b>`
      : "<b></b>").join("");

    const lo = results.filter((v) => v < 2).length, hi = results.length - lo, n = results.length;
    const pct = (c) => (c / n * 100).toFixed(2) + "%";
    const set = (id, t) => { document.getElementById(id).textContent = t; };
    set("n", n.toLocaleString());
    set("lo-p", pct(lo)); set("lo-c", lo); set("lo-m", maxRun(results, (v) => v < 2));
    set("hi-p", pct(hi)); set("hi-c", hi); set("hi-m", maxRun(results, (v) => v >= 2));
    const v = results[results.length - 1];
    const el = document.getElementById("last");
    el.textContent = v.toFixed(2) + "×";
    el.style.color = `var(--${kind(v)})`;
  }

  for (let i = 0; i < KEEP; i++) results.push(crash());
  render(false);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) setInterval(() => {
    results.push(crash());
    if (results.length > KEEP) results.shift();
    render(true);
  }, 1800);
  window.addEventListener("resize", () => render(false));

  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();
})();
