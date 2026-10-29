// Runs inside the bc.game page. Watches data the page itself receives
// (fetch, XHR, WebSocket) for round hashes and passes them to content.js.
// It only reads; it never sends anything to bc.game.
(() => {
  if (window.__bcCrashHashInject) return;
  window.__bcCrashHashInject = true;
  const HEX64 = /^[0-9a-f]{64}$/i;
  const seen = new Set();

  const post = (c) => {
    const key = `${c.kind}|${c.hash}|${c.roundId ?? ""}|${c.salt ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 5000) seen.clear();
    window.postMessage({ __bcCrashHash: true, ...c }, window.location.origin);
  };

  // Look for objects that have a "...hash" field with 64 hex chars,
  // plus an optional round id and salt next to it.
  function scanJson(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 10) return;
    if (Array.isArray(obj)) return obj.forEach((o) => scanJson(o, depth + 1));
    let hash, salt, roundId;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        if (HEX64.test(v) && /hash/i.test(k)) hash = v;
        else if (HEX64.test(v) && /salt/i.test(k)) salt = v;
        else if (/^(gameId|roundId|round|gameNo|issue)$/i.test(k) && /^\d{4,}$/.test(v)) roundId = Number(v);
        else if (/^\s*[{[]/.test(v)) { try { scanJson(JSON.parse(v), depth + 1); } catch {} }
      } else if (typeof v === "number" && /^(gameId|roundId|round|gameNo|issue)$/i.test(k)) {
        roundId = v;
      } else if (v && typeof v === "object") {
        scanJson(v, depth + 1);
      }
    }
    if (hash) post({ kind: roundId != null ? "json" : "loose", hash, salt, roundId: roundId ?? null });
  }

  // Any 64-hex run in text or binary. These are only accepted later if they
  // chain onto a known round, so stray hashes are ignored.
  function scanLoose(text) {
    for (const h of text.match(/[0-9a-f]{64}/gi) ?? []) post({ kind: "loose", hash: h });
  }

  function scanText(text) {
    if (typeof text !== "string" || text.length > 3e6) return;
    const m = text.trim().match(/^\d*([[{][\s\S]*)$/); // also handles socket.io "42[...]"
    if (m) { try { scanJson(JSON.parse(m[1])); } catch {} }
    scanLoose(text);
  }

  function scanBinary(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length > 3e6) return;
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    scanLoose(s);
  }

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      if ((res.headers.get("content-type") || "").includes("json")) res.clone().text().then(scanText, () => {});
    } catch {}
    return res;
  };

  // XMLHttpRequest
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (this.responseType === "" || this.responseType === "text") scanText(this.responseText);
        else if (this.responseType === "json") scanJson(this.response);
        else if (this.responseType === "arraybuffer") scanBinary(this.response);
      } catch {}
    });
    return origSend.apply(this, args);
  };

  // WebSocket
  const OrigWS = window.WebSocket;
  window.WebSocket = new Proxy(OrigWS, {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener("message", (e) => {
        try {
          if (typeof e.data === "string") scanText(e.data);
          else if (e.data instanceof ArrayBuffer) scanBinary(e.data);
          else if (e.data instanceof Blob) e.data.arrayBuffer().then(scanBinary, () => {});
        } catch {}
      });
      return ws;
    },
  });
})();
