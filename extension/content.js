// Runs on bc.game pages.
//  - Forwards hashes that inject.js finds in the page's own data.
//  - Reads the round details box ("Round ID ... Salt ... Hash ...") whenever it is open.
//  - On request from the panel, opens the newest round in the page's result
//    strip, reads its details box, and closes it again. Only one box is ever
//    open at a time.

if (!window.__bcCrashHashContent) {
  window.__bcCrashHashContent = true;

  const HEX64 = /[0-9a-f]{64}/i;
  const stats = { pageHashes: 0, boxReads: 0 };

  const send = (c) => {
    try { chrome.runtime.sendMessage({ type: "candidate", ...c }); } catch {}
  };

  // ---- Page data from inject.js ----
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data?.__bcCrashHash) return;
    stats.pageHashes++;
    const { kind, hash, salt, roundId } = e.data;
    send({ kind, hash, salt, roundId });
  });

  // ---- Details box reader ----

  const isShown = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  };

  // All text of an element in page order, including values of input/textarea
  // fields (the hash is often shown in a read-only field for copying).
  function textWithFields(root) {
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { parts.push(node.nodeValue); return; }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
      if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") parts.push(" " + node.value + " ");
      if (node.shadowRoot) walk(node.shadowRoot);
      for (const child of node.childNodes) walk(child);
      if (node.nodeType === Node.ELEMENT_NODE && /^(DIV|P|LI|TR|SECTION|H\d|LABEL|SPAN|BUTTON)$/.test(node.tagName)) parts.push(" ");
    };
    walk(root);
    return parts.join("").replace(/\s+/g, " ");
  }

  // Smallest visible element that contains "Round ID" and a 64-hex hash.
  function findBox() {
    const labels = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) if (/Round\s*ID/i.test(tw.currentNode.nodeValue)) labels.push(tw.currentNode.parentElement);
    for (const label of labels) {
      if (!isShown(label)) continue;
      for (let el = label, depth = 0; el && depth < 12; el = el.parentElement, depth++) {
        const text = textWithFields(el);
        if (HEX64.test(text) && /Hash/i.test(text)) return { el, text };
      }
    }
    return null;
  }

  function parseBox(text) {
    const round = text.match(/Round\s*ID\s*:?\s*#?\s*(\d{4,})/i);
    const hash = text.match(/\bHash\s*:?\s*([0-9a-f]{64})/i);
    const salt = text.match(/\bSalt\s*:?\s*([0-9a-f]{64})/i);
    const crash = text.match(/(\d+(?:\.\d+)?)\s*[x×]/i);
    if (!round || !hash) return null;
    return {
      roundId: Number(round[1]),
      hash: hash[1].toLowerCase(),
      salt: salt ? salt[1].toLowerCase() : null,
      shownCrash: crash ? Number(crash[1]) : null,
    };
  }

  function readBox() {
    const box = findBox();
    const info = box && parseBox(box.text);
    return info ? { ...info, el: box.el } : null;
  }

  let lastKey = "";
  function readAndSend() {
    const info = readBox();
    if (!info) return null;
    stats.boxReads++;
    const key = `${info.roundId}|${info.hash}`;
    if (key !== lastKey) {
      lastKey = key;
      send({ kind: "dom", roundId: info.roundId, hash: info.hash, salt: info.salt });
    }
    return info;
  }

  // Check the page at most every 500 ms while it changes. (A debounce would
  // never fire: the running crash multiplier changes the page constantly.)
  let scheduled = false, lastRun = 0;
  const tick = () => {
    scheduled = false;
    lastRun = Date.now();
    try { readAndSend(); checkStrip(); } catch {}
  };
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(tick, Math.max(0, 500 - (Date.now() - lastRun)));
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(tick, 0);

  // ---- Result strip ----

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  // The round result strip: a parent with 5+ visible children whose text is a
  // multiplier with two decimals, like "1.23x". (Two decimals on purpose, so bet
  // panel buttons like "2x" are never clicked.)
  function findHistoryItems() {
    const MULT = /^\s*\d+\.\d{2}\s*[x×]\s*$/i;
    const groups = new Map();
    for (const el of document.body.querySelectorAll("*")) {
      if (el.children.length > 2) continue;
      const t = el.textContent;
      if (!t || t.length > 14 || !MULT.test(t) || !visible(el)) continue;
      let item = el;
      while (item.parentElement && item.parentElement !== document.body && MULT.test(item.parentElement.textContent)) item = item.parentElement;
      const parent = item.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, new Set());
      groups.get(parent).add(item);
    }
    let best = [];
    for (const items of groups.values()) if (items.size > best.length) best = [...items];
    return best.length >= 5 ? best : [];
  }

  // Which end of the strip holds the newest round: "first" or "last".
  // Learned by watching where new results appear, or from a two-end check
  // the first time. Saved so later lookups click only one result.
  let newestEnd = null;
  chrome.storage.local.get("newestEnd").then((r) => { newestEnd = newestEnd ?? r.newestEnd ?? null; }, () => {});
  const saveEnd = (end) => {
    if (newestEnd === end) return;
    newestEnd = end;
    chrome.storage.local.set({ newestEnd: end }).catch(() => {});
  };

  // ---- Live rounds from the strip ----
  // Each time the strip changes, compare it with the last reading to see how
  // many new results were added and at which end. New multipliers are sent to
  // the extension so scores update every round, without clicking anything.
  // (They are confirmed later by the hash chain when the next hash is read.)
  const MULT_TEXT = /^\s*(\d+\.\d{2})\s*[x×]\s*$/i;
  let stripEl = null;
  let lastSeq = null; // multipliers in page order

  function stripItems() {
    if (stripEl?.isConnected) {
      const items = [...stripEl.children].filter((c) => MULT_TEXT.test(c.textContent));
      if (items.length >= 5) return items;
    }
    const items = findHistoryItems();
    stripEl = items[0]?.parentElement ?? null;
    return items;
  }
  function watchStrip() { stripItems(); }

  // How many new values were added at the front (or back) of `now` compared with `before`.
  function shift(now, before, atFront) {
    for (let k = 1; k <= 5; k++) {
      const L = Math.min(now.length - k, before.length);
      if (L < 4) break;
      let same = true;
      for (let i = 0; i < L && same; i++) {
        same = atFront ? now[k + i] === before[i] : now[now.length - 1 - k - i] === before[before.length - 1 - i];
      }
      if (same) return k;
    }
    return 0;
  }

  function checkStrip() {
    const items = stripItems();
    if (items.length < 5) return;
    const seq = items.map((el) => Number(el.textContent.match(MULT_TEXT)?.[1]));
    if (seq.some((v) => !(v >= 1))) return;
    const before = lastSeq;
    lastSeq = seq;
    if (!before || before.join() === seq.join()) return;
    const front = shift(seq, before, true), back = shift(seq, before, false);
    let added = [];
    if (front && (!back || newestEnd === "first")) { saveEnd("first"); added = seq.slice(0, front).reverse(); }
    else if (back) { saveEnd("last"); added = seq.slice(seq.length - back); }
    if (added.length) {
      try { chrome.runtime.sendMessage({ type: "stripRounds", crashes: added }); } catch {} // oldest first
    }
  }

  // ---- Opening and closing a box ----

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function click(el) {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, at) : new MouseEvent(type, at));
    }
  }

  async function waitFor(test, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = test();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  async function waitForBox(ms = 3000) {
    return waitFor(() => readBox(), ms);
  }

  const coversScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
  };

  // The window (panel) that holds the box: the largest ancestor that is
  // still smaller than the screen. Its backdrop (overlay): the nearest
  // fixed, screen-covering ancestor above it, if any.
  function panelAndOverlay(el) {
    let panel = el;
    for (let n = el.parentElement, depth = 0; n && n !== document.body && depth < 8; n = n.parentElement, depth++) {
      if (coversScreen(n)) break;
      panel = n;
    }
    let overlay = null;
    for (let n = panel.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).position === "fixed" && coversScreen(n)) { overlay = n; break; }
    }
    return { panel, overlay };
  }

  // Close button inside the window: something labelled close, or the small
  // icon nearest its top-right corner (header area only).
  function closeButtonIn(panel) {
    const labelled = panel.querySelector('[aria-label*="close" i], [title*="close" i], [class*="close" i], [data-testid*="close" i]');
    if (labelled && isShown(labelled)) return labelled;
    const box = panel.getBoundingClientRect();
    let best = null, bestD = Infinity;
    for (const el of panel.querySelectorAll("button, [role=button], svg, i, span, div")) {
      if (!isShown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 48 || r.height > 48 || r.width < 8) continue;
      if (r.top > box.top + 80) continue; // only the header area
      if (/\d|[a-z]{3,}/i.test(el.textContent.trim())) continue; // not a text label
      const d = Math.hypot(box.right - r.right, r.top - box.top);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best ? best.closest("button, [role=button]") ?? best : null;
  }

  async function closeBox(info) {
    const gone = () => {
      const now = readBox();
      return !now || now.hash !== info.hash;
    };
    const { panel, overlay } = panelAndOverlay(info.el);
    const urlBefore = location.href;

    const attempts = [
      () => { const b = closeButtonIn(panel); if (b) click(b); },
      () => {
        const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
        for (const t of [document.activeElement, document.body, document, window]) t?.dispatchEvent(new KeyboardEvent("keydown", opts));
      },
      () => {
        // Click the dimmed backdrop beside the window -- only if there is one,
        // so nothing on the page underneath is ever clicked.
        if (!overlay) return;
        const pr = panel.getBoundingClientRect();
        const points = [[pr.left / 2, innerHeight / 2], [(pr.right + innerWidth) / 2, innerHeight / 2], [innerWidth / 2, pr.top / 2]];
        for (const [x, y] of points) {
          const target = document.elementFromPoint(x, y);
          if (target && overlay.contains(target) && !panel.contains(target)) { click(target); break; }
        }
      },
      () => { if (location.href !== urlBefore) history.back(); },
    ];
    for (const attempt of attempts) {
      if (gone()) return true;
      try { attempt(); } catch {}
      if (await waitFor(gone, 700)) return true;
    }
    return gone();
  }

  // Click one result, read its box, close it. Returns the round info or null.
  async function openRead(item, debug) {
    const label = item.textContent.trim();
    click(item);
    const info = await waitForBox();
    if (!info) { debug.tried.push(`clicked "${label}": no details box`); return null; }
    readAndSend();
    const closed = await closeBox(info);
    debug.tried.push(`clicked "${label}": round ${info.roundId}${closed ? "" : " (couldn't close the box)"}`);
    const { el, ...round } = info;
    return { round, closed };
  }

  let busy = false;
  async function getLatest() {
    const debug = { url: location.href, pageHashes: stats.pageHashes, historyItems: 0, newestEnd, tried: [] };
    if (busy) return { ok: false, debug, error: "Already reading a round, try again in a moment." };
    busy = true;
    try {
      // A box is already open (e.g. the user opened one): close it first.
      const open = readBox();
      if (open) {
        readAndSend();
        if (!(await closeBox(open))) {
          return { ok: false, debug: { ...debug, tried: ["a details box was already open and couldn't be closed"] }, error: "bc.game's round box didn't close automatically — please close it by hand." };
        }
      }

      const items = findHistoryItems();
      debug.historyItems = items.length;
      if (!items.length) return { ok: false, debug, error: "Couldn't find the round result strip (the row of results like 1.23x) on this page." };
      watchStrip();

      const first = items[0], last = items[items.length - 1];
      if (newestEnd) {
        const r = await openRead(newestEnd === "first" ? first : last, debug);
        if (!r) return { ok: false, debug, error: "Clicked the newest result, but no Round ID / Hash box appeared." };
        return { ok: true, round: r.round, debug, warning: r.closed ? "" : "bc.game's round box didn't close automatically — please close it by hand." };
      }

      // Not known yet: check one end, close it, then the other end, and remember which was newer.
      const a = await openRead(first, debug);
      // Never open a second box while one is still open.
      if (a && !a.closed) return { ok: false, debug, error: "bc.game's round box didn't close automatically — please close it by hand." };
      const b = await openRead(last, debug);
      if (!a && !b) return { ok: false, debug, error: "Clicked the result strip, but no Round ID / Hash box appeared." };
      if (a && b) saveEnd(a.round.roundId >= b.round.roundId ? "first" : "last");
      const best = !b || (a && a.round.roundId >= b.round.roundId) ? a : b;
      return { ok: true, round: best.round, debug: { ...debug, newestEnd } };
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "getLatest") {
      getLatest().then(reply, (e) => reply({ ok: false, error: String(e), debug: {} }));
      return true;
    }
    if (msg?.type === "ping") reply({ ok: true, pageHashes: stats.pageHashes, boxReads: stats.boxReads });
  });
}
