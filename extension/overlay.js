// Shows the trend panel inside the bc.game crash page: a floating box you can
// drag by its title bar, resize sideways, minimise and close. The panel itself
// is panel.html in an iframe, so it runs as an extension page and the page's
// own scripts and styles can't touch it. The toolbar icon shows/hides it.

if (!window.__bcTrendOverlay) {
  window.__bcTrendOverlay = true;

  const KEY = "overlay-v2"; // v2: wider default for the 30-column trend
  const DEFAULT = { left: null, top: 80, width: 640, collapsed: false, closed: false };
  let st = { ...DEFAULT };
  let host = null, box = null, frame = null, frameH = 300;

  const onCrashPage = () => /\/game\/crash/.test(location.pathname);
  const save = () => { try { chrome.storage.local.set({ [KEY]: st }); } catch {} };

  function build() {
    host = document.createElement("div");
    host.id = "bc-crash-trend-panel";
    host.style.cssText = "all:initial; position:fixed; z-index:2147483646; top:0; left:0;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .box { position:fixed; background:#0f1115; border:1px solid #2a2f3a; border-radius:10px; box-shadow:0 8px 30px #000a;
               overflow:hidden; resize:horizontal; min-width:300px; max-width:95vw; display:flex; flex-direction:column;
               font:12px system-ui, sans-serif; color:#e6e8ee; }
        .head { display:flex; align-items:center; gap:6px; padding:5px 8px; background:#181b22; cursor:move; user-select:none; border-bottom:1px solid #2a2f3a; }
        .head b { flex:1; font-size:12px; }
        .head button { all:unset; cursor:pointer; color:#8a91a3; font-size:15px; line-height:1; padding:0 4px; }
        .head button:hover { color:#fff; }
        iframe { border:0; width:100%; display:block; background:#0f1115; color-scheme:dark; }
        .box.collapsed iframe { display:none; }
        .box.collapsed { resize:none; }
      </style>
      <div class="box">
        <div class="head"><b>BC Crash Trend</b><button class="min" title="Minimise">\u2013</button><button class="close" title="Close (click the extension icon to show again)">\u00d7</button></div>
        <iframe allow="clipboard-write"></iframe>
      </div>`;
    box = root.querySelector(".box");
    frame = root.querySelector("iframe");
    frame.src = chrome.runtime.getURL("panel.html");

    root.querySelector(".min").onclick = () => { st.collapsed = !st.collapsed; apply(); save(); };
    root.querySelector(".close").onclick = () => { st.closed = true; apply(); save(); };

    // Drag by the title bar
    const head = root.querySelector(".head");
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = box.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => { st.left = ev.clientX - dx; st.top = ev.clientY - dy; place(); };
      const up = () => { head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); save(); };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });

    // Remember the width after a resize
    let t = 0;
    new ResizeObserver(() => {
      if (st.collapsed || !box.offsetWidth) return;
      clearTimeout(t);
      t = setTimeout(() => { if (Math.abs(box.offsetWidth - st.width) > 2) { st.width = box.offsetWidth; save(); } }, 300);
    }).observe(box);

    document.documentElement.append(host);
  }

  // The panel reports its height so the frame fits it without a scrollbar.
  window.addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data?.__bcTrendPanel === "fitWidth") { st.width = Math.max(300, Number(e.data.w) || st.width); place(); save(); return; }
    if (e.data?.__bcTrendPanel !== "height") return;
    frameH = Math.max(80, Number(e.data.h) || 0);
    place();
  });

  function place() {
    if (!box) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(st.width, vw - 8);
    box.style.width = w + "px";
    const headH = 28;
    frame.style.height = Math.min(frameH, vh - headH - 16) + "px";
    const left = st.left == null ? vw - w - 16 : st.left;
    box.style.left = Math.max(0, Math.min(left, vw - 60)) + "px";
    box.style.top = Math.max(0, Math.min(st.top, vh - headH)) + "px";
  }

  function apply() {
    const show = onCrashPage() && !st.closed;
    if (show && !host) build();
    if (!host) return;
    host.style.display = show ? "" : "none";
    box.classList.toggle("collapsed", st.collapsed);
    host.shadowRoot.querySelector(".min").textContent = st.collapsed ? "+" : "\u2013";
    place();
  }

  chrome.storage.local.get(KEY).then((r) => {
    st = { ...DEFAULT, ...(r[KEY] || {}) };
    apply();
  });

  // bc.game is a single-page app: follow route changes.
  let path = location.pathname;
  setInterval(() => { if (location.pathname !== path) { path = location.pathname; apply(); } }, 1000);
  window.addEventListener("resize", place);

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "togglePanel") return;
    const visible = !!host && host.style.display !== "none";
    st.closed = visible;
    if (!st.closed) st.collapsed = false;
    apply();
    save();
    reply({ ok: true, onCrashPage: onCrashPage() });
  });
}
