// Small canvas chart helper for the report page.
// layers: { type: "line"|"band"|"hline"|"errorbars"|"bars"|"points", ... }

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

export function drawChart(canvas, { height = 240, x: xd, y: yd, xFormat = String, yFormat = String, xLabel = "", yLabel = "", layers = [] }) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(200, canvas.clientWidth || canvas.parentElement?.clientWidth || 600);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);

  const pad = { l: 58, r: 12, t: 10, b: 34 };
  const pw = w - pad.l - pad.r, ph = height - pad.t - pad.b;
  const X = (v) => pad.l + ((v - xd[0]) / (xd[1] - xd[0] || 1)) * pw;
  const Y = (v) => pad.t + ph - ((v - yd[0]) / (yd[1] - yd[0] || 1)) * ph;
  const C = { line: css("--line", "#2a2f3a"), muted: css("--muted", "#8a91a3"), text: css("--text", "#e6e8ee") };

  // Grid and axes
  ctx.font = "11px system-ui, sans-serif";
  ctx.strokeStyle = C.line;
  ctx.fillStyle = C.muted;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  for (const t of niceTicks(yd[0], yd[1])) {
    ctx.beginPath(); ctx.moveTo(pad.l, Math.round(Y(t)) + 0.5); ctx.lineTo(w - pad.r, Math.round(Y(t)) + 0.5); ctx.stroke();
    ctx.fillText(yFormat(t), pad.l - 6, Y(t) + 4);
  }
  ctx.textAlign = "center";
  for (const t of niceTicks(xd[0], xd[1], Math.max(2, Math.floor(pw / 90)))) ctx.fillText(xFormat(t), X(t), height - pad.b + 16);
  if (xLabel) ctx.fillText(xLabel, pad.l + pw / 2, height - 3);
  if (yLabel) { ctx.save(); ctx.translate(11, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore(); }

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
  for (const L of layers) {
    ctx.strokeStyle = L.color || C.text;
    ctx.fillStyle = L.color || C.text;
    ctx.lineWidth = L.width || 1.5;
    ctx.setLineDash(L.dash || []);
    if (L.type === "line") {
      ctx.beginPath();
      L.points.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b))));
      ctx.stroke();
    } else if (L.type === "band") {
      ctx.globalAlpha = L.alpha ?? 0.15;
      ctx.beginPath();
      L.upper.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b))));
      for (let i = L.lower.length - 1; i >= 0; i--) ctx.lineTo(X(L.lower[i][0]), Y(L.lower[i][1]));
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (L.type === "hline") {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(L.y)); ctx.lineTo(w - pad.r, Y(L.y)); ctx.stroke();
    } else if (L.type === "errorbars") {
      for (const [a, b, lo, hi] of L.points) {
        ctx.beginPath(); ctx.moveTo(X(a), Y(lo)); ctx.lineTo(X(a), Y(hi));
        ctx.moveTo(X(a) - 4, Y(lo)); ctx.lineTo(X(a) + 4, Y(lo)); ctx.moveTo(X(a) - 4, Y(hi)); ctx.lineTo(X(a) + 4, Y(hi)); ctx.stroke();
        ctx.beginPath(); ctx.arc(X(a), Y(b), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    } else if (L.type === "bars") {
      const bw = Math.max(2, (pw / L.points.length) * 0.6);
      for (const [a, b] of L.points) {
        ctx.fillStyle = L.colorOf ? L.colorOf(b) : L.color;
        const y0 = Y(0), y1 = Y(b);
        ctx.fillRect(X(a) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
      }
    } else if (L.type === "points") {
      for (const [a, b] of L.points) { ctx.beginPath(); ctx.arc(X(a), Y(b), L.r || 3, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.restore();
  ctx.setLineDash([]);
}
