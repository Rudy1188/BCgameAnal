// Keeps the latest known round in chrome.storage.local.
//
// Rules:
//  - "dom"/"json"/"manual" candidates carry a round ID; the highest round wins.
//  - "loose" candidates (a bare hash) are only accepted if hashing it back a
//    few times reaches the current latest hash, so stray hashes are ignored.
//  - A new round is marked "verified" when it chains onto the previous one.
import { DEFAULT_SALT, crashPoint, isHash, stepsAhead } from "./crash.js";

let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "candidate") {
    queue = queue.then(() => handle(msg)).catch((e) => console.warn("BC Crash Hash:", e));
    return;
  }
  if (msg?.type === "stripRounds" && Array.isArray(msg.crashes)) {
    // New results read from the page strip, not yet confirmed by a hash.
    queue = queue.then(async () => {
      const { pending = [] } = await chrome.storage.local.get("pending");
      const now = Date.now();
      for (const c of msg.crashes) if (c >= 1 && c < 1e7) pending.push({ c, at: now });
      await chrome.storage.local.set({ pending: pending.slice(-5000) });
      await setBadge(msg.crashes[msg.crashes.length - 1]);
    }).catch((e) => console.warn("BC Crash Hash:", e));
    return;
  }
  if (msg?.type === "reset") {
    queue = queue.then(() => chrome.storage.local.clear()).then(() => setBadge(null)).then(() => reply({ ok: true }));
    return true;
  }
});

async function handle(c) {
  if (!isHash(c.hash)) return;
  const hash = c.hash.toLowerCase();
  const { latest, salt: storedSalt } = await chrome.storage.local.get(["latest", "salt"]);
  const salt = isHash(c.salt ?? "") ? c.salt.toLowerCase() : storedSalt || DEFAULT_SALT;
  if (isHash(c.salt ?? "") && c.salt.toLowerCase() !== storedSalt) await chrome.storage.local.set({ salt });

  if (latest && hash === latest.hash) return;

  let next = null;
  if (c.roundId != null && Number.isInteger(c.roundId)) {
    if (!latest || latest.roundId == null || c.roundId > latest.roundId) {
      let verified = false;
      if (latest) {
        const steps = await stepsAhead(hash, latest.hash);
        verified = steps > 0 && (latest.roundId == null || latest.roundId + steps === c.roundId);
      }
      next = { roundId: c.roundId, hash, verified, source: c.kind };
    }
  } else if (latest) {
    const steps = await stepsAhead(hash, latest.hash);
    if (steps > 0) {
      next = { roundId: latest.roundId != null ? latest.roundId + steps : null, hash, verified: true, source: c.kind };
    }
  }
  if (!next) return;

  next.crash = await crashPoint(hash, salt);
  next.salt = salt;
  next.seenAt = Date.now();
  // The new hash covers every round up to now, so unconfirmed strip rounds are no longer needed.
  await chrome.storage.local.set({ latest: next, pending: [] });
  await setBadge(next.crash);
}

async function setBadge(crash) {
  await chrome.action.setBadgeText({ text: crash == null ? "" : crash >= 100 ? String(Math.floor(crash)) : crash.toFixed(crash >= 10 ? 0 : 1) });
  await chrome.action.setBadgeBackgroundColor({ color: crash >= 10 ? "#c99a1e" : crash >= 2 ? "#1f9d55" : "#d64545" });
}

// ---- Toolbar button: open the trend window (or bring it to the front) ----
// A normal window stays open while you play, unlike a popup that closes on any click.
const WINDOW_URL = chrome.runtime.getURL("popup.html");
const DEFAULT_BOUNDS = { width: 400, height: 720 };

chrome.action.onClicked.addListener(async () => {
  const { trendWindowId } = await chrome.storage.session.get("trendWindowId");
  if (trendWindowId != null) {
    try {
      const w = await chrome.windows.get(trendWindowId, { populate: true });
      if (w.tabs?.some((t) => t.url?.startsWith(WINDOW_URL))) {
        await chrome.windows.update(trendWindowId, { focused: true, state: "normal" });
        return;
      }
    } catch {} // window was closed
  }
  const { trendBounds } = await chrome.storage.local.get("trendBounds");
  const w = await chrome.windows.create({ url: WINDOW_URL, type: "popup", ...DEFAULT_BOUNDS, ...trendBounds });
  await chrome.storage.session.set({ trendWindowId: w.id });
});

// Remember where the window was moved/resized to.
chrome.windows.onBoundsChanged.addListener(async (w) => {
  const { trendWindowId } = await chrome.storage.session.get("trendWindowId");
  if (w.id !== trendWindowId) return;
  const { left, top, width, height } = w;
  await chrome.storage.local.set({ trendBounds: { left, top, width, height } });
});
