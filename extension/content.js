// Bridges inject.js to the extension, and reads the round details box
// ("Round ID ... Salt ... Hash ...") whenever it is open on the page.

const send = (c) => {
  try { chrome.runtime.sendMessage({ type: "candidate", ...c }); } catch {}
};

// From inject.js (page data).
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data?.__bcCrashHash) return;
  const { kind, hash, salt, roundId } = e.data;
  send({ kind, hash, salt, roundId });
});

// From the round details box.
let lastDom = "";
function readDetailsBox() {
  const text = document.body?.innerText ?? "";
  let from = 0;
  for (;;) {
    const i = text.indexOf("Round ID", from);
    if (i === -1) break;
    from = i + 8;
    const chunk = text.slice(i, i + 1200);
    const round = chunk.match(/Round ID\s*#?\s*(\d{4,})/i);
    const hash = chunk.match(/\bHash\s*([0-9a-f]{64})/i);
    const salt = chunk.match(/\bSalt\s*([0-9a-f]{64})/i);
    if (!round || !hash) continue;
    const key = `${round[1]}|${hash[1]}`;
    if (key === lastDom) return;
    lastDom = key;
    send({ kind: "dom", roundId: Number(round[1]), hash: hash[1], salt: salt?.[1] ?? null });
    return;
  }
}

let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(readDetailsBox, 400);
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
readDetailsBox();
