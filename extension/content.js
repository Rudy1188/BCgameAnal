// Runs on bc.game pages.
//  - Forwards hashes that inject.js finds in the page's own data.
//  - Reads the round details box ("Round ID ... Salt ... Hash ...") whenever it is open.
//  - On request from the popup ("Get latest round"), opens the newest round in the
//    page's round history, reads its details box, and closes it again.

if (!window.__bcCrashHashContent) {
  window.__bcCrashHashContent = true;

  const HEX64 = /[0-9a-f]{64}/i;
  const stats = { pageHashes: 0, boxReads: 0, lastBox: null };

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

  // Smallest element that contains "Round ID" and a 64-hex hash.
  function findBox() {
    const labels = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) if (/Round\s*ID/i.test(tw.currentNode.nodeValue)) labels.push(tw.currentNode.parentElement);
    for (const label of labels) {
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
    stats.lastBox = info.roundId;
    const key = `${info.roundId}|${info.hash}`;
    if (key !== lastKey) {
      lastKey = key;
      send({ kind: "dom", roundId: info.roundId, hash: info.hash, salt: info.salt });
    }
    return info;
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(readAndSend, 400);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  readAndSend();

  // ---- "Get latest round" ----

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  // The round history strip: a parent with 5+ visible children whose text is a
  // multiplier with two decimals, like "1.23x". (Two decimals on purpose, so bet
  // panel buttons like "2x" are never clicked.)
  function findHistoryItems() {
    const MULT = /^\s*\d+\.\d{2}\s*[x×]\s*$/i;
    const groups = new Map();
    for (const el of document.body.querySelectorAll("*")) {
      if (el.children.length > 2) continue;
      const t = el.textContent;
      if (!t || t.length > 14 || !MULT.test(t) || !visible(el)) continue;
      // Use the outermost ancestor that still has only this multiplier as text.
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForBox(previousHash, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const info = readBox();
      if (info && info.hash !== previousHash) return info;
      await sleep(150);
    }
    return null;
  }

  function closeBox(boxEl) {
    const opts = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true };
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.body.dispatchEvent(new KeyboardEvent("keydown", opts));
    // Also try a close button inside the dialog that holds the box.
    const dialog = boxEl?.closest('[role="dialog"], [class*="dialog" i], [class*="modal" i], [class*="popup" i]');
    const btn = dialog?.querySelector('[aria-label*="close" i], [class*="close" i]');
    btn?.click();
  }

  function click(el) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function getLatest() {
    const debug = { url: location.href, pageHashes: stats.pageHashes, historyItems: 0, tried: [] };

    // A details box already open?
    let best = readAndSend();
    if (best) debug.tried.push(`open box: round ${best.roundId}`);

    const items = findHistoryItems();
    debug.historyItems = items.length;
    if (!items.length && !best) {
      return { ok: false, debug, error: "Couldn't find the round history strip (the row of results like 1.23x) on this page." };
    }

    // Newest is at one end of the strip; try both ends and keep the higher round ID.
    const ends = items.length ? [items[0], items[items.length - 1]] : [];
    for (const item of ends) {
      const before = readBox();
      if (before) { closeBox(before.el); await sleep(300); }
      click(item);
      const info = await waitForBox(before?.hash);
      debug.tried.push(info ? `clicked "${item.textContent.trim()}": round ${info.roundId}` : `clicked "${item.textContent.trim()}": no details box`);
      if (info) {
        readAndSend();
        if (!best || info.roundId > best.roundId) best = info;
        closeBox(info.el);
        await sleep(300);
      }
    }

    if (!best) return { ok: false, debug, error: "Clicked the round history, but no Round ID / Hash box appeared." };
    send({ kind: "dom", roundId: best.roundId, hash: best.hash, salt: best.salt });
    const { el, ...round } = best;
    return { ok: true, round, debug };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "getLatest") {
      getLatest().then(reply, (e) => reply({ ok: false, error: String(e), debug: {} }));
      return true;
    }
    if (msg?.type === "ping") reply({ ok: true, pageHashes: stats.pageHashes, boxReads: stats.boxReads });
  });
}
