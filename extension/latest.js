// Asks the open bc.game tab for the newest round (used by the popup on open).
import { DEFAULT_SALT, crashPoint } from "./crash.js";

async function findBcTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && /^https:\/\/([a-z0-9-]+\.)*bc\.game\//i.test(active.url)) return active;
  const tabs = await chrome.tabs.query({ url: ["https://bc.game/*", "https://*.bc.game/*"] });
  return tabs.find((t) => /\/game\/crash/.test(t.url ?? "")) ?? tabs[0] ?? null;
}

async function askTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "getLatest" });
  } catch {
    // The tab was open before the extension was installed/reloaded: start it now.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, { type: "getLatest" });
  }
}

/**
 * Returns { ok, message, cls } for the status line. Saves the round when found.
 */
export async function updateFromTab(current) {
  const tab = await findBcTab();
  if (!tab) return { ok: false, cls: "", message: "Open bc.game/game/crash to update automatically." };
  let res;
  try {
    res = await askTab(tab.id);
  } catch (e) {
    return { ok: false, cls: "err", message: `Couldn't read the bc.game tab (${e.message}). Reload it and open this popup again.` };
  }
  if (!res?.ok) {
    const d = res?.debug ?? {};
    return {
      ok: false,
      cls: "err",
      message: `${res?.error ?? "No answer from the bc.game tab. Reload it and try again."}\n` +
        `Details: history items found ${d.historyItems ?? 0}, page-data hashes seen ${d.pageHashes ?? 0}` +
        `${d.tried?.length ? `, tried: ${d.tried.join("; ")}` : ""}`,
    };
  }
  const r = res.round;
  const salt = r.salt || current?.salt || DEFAULT_SALT;
  const crash = crashPoint(r.hash, salt);
  if (!current || current.roundId == null || r.roundId >= current.roundId) {
    const verified = current?.hash === r.hash ? current.verified : false;
    await chrome.storage.local.set({ latest: { roundId: r.roundId, hash: r.hash, salt, crash, verified, source: "dom", seenAt: Date.now() }, salt });
  }
  const check = r.shownCrash != null && Math.abs(r.shownCrash - crash) < 0.005 ? ` ✔ matches bc.game` : "";
  return { ok: true, cls: "ok", message: `Updated from bc.game: round ${r.roundId}, ${crash.toFixed(2)}×${check}` };
}
