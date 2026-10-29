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
  await chrome.storage.local.set({ latest: next });
  await setBadge(next.crash);
}

async function setBadge(crash) {
  await chrome.action.setBadgeText({ text: crash == null ? "" : crash >= 100 ? String(Math.floor(crash)) : crash.toFixed(crash >= 10 ? 0 : 1) });
  await chrome.action.setBadgeBackgroundColor({ color: crash >= 10 ? "#c99a1e" : crash >= 2 ? "#1f9d55" : "#d64545" });
}
