// BC.Game Crash provably-fair calculation (browser version, Web Crypto).
// Checked against round 9745447: hash 0ab60395...0b7e -> 8.17x.

export const DEFAULT_SALT =
  "000000000000000000010283162e089cc99f643ee5043141412e839945afe2f9";

export const isHash = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

/** Previous round's hash = SHA-256 of this hash (as hex text). */
export async function previousHash(hash) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(hash)));
}

const keys = new Map();
function hmacKey(salt) {
  if (!keys.has(salt)) {
    keys.set(salt, crypto.subtle.importKey("raw", enc.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  }
  return keys.get(salt);
}

/** Crash point: HMAC-SHA256(key = salt, message = hash bytes), first 52 bits -> multiplier. */
export async function crashPoint(hash, salt = DEFAULT_SALT) {
  const sig = toHex(await crypto.subtle.sign("HMAC", await hmacKey(salt), fromHex(hash)));
  const r = parseInt(sig.slice(0, 13), 16);
  let x = r / 2 ** 52;
  x = parseFloat(x.toPrecision(9));
  x = 99 / (1 - x);
  return Math.max(1, Math.floor(x) / 100);
}

/** Rounds from the latest backwards, newest first. */
export async function history(latestHash, count, latestRoundId = null, salt = DEFAULT_SALT) {
  const rounds = [];
  let hash = latestHash.toLowerCase();
  for (let i = 0; i < count; i++) {
    rounds.push({ roundId: latestRoundId != null ? latestRoundId - i : null, hash, crash: await crashPoint(hash, salt) });
    hash = await previousHash(hash);
  }
  return rounds;
}

/** How many rounds `newer` is ahead of `older` (1..maxSteps), or 0 if not on the same chain. */
export async function stepsAhead(newer, older, maxSteps = 200) {
  let h = newer.toLowerCase();
  for (let i = 1; i <= maxSteps; i++) {
    h = await previousHash(h);
    if (h === older.toLowerCase()) return i;
  }
  return 0;
}
