// BC.Game Crash provably-fair calculation.
// Checked against round 9745447: hash 0ab60395...0b7e -> 8.17x.
//
// Uses a small built-in SHA-256 instead of Web Crypto: Web Crypto is async per
// call and took ~30s for 50,000 rounds; this takes well under a second.

export const DEFAULT_SALT =
  "000000000000000000010283162e089cc99f643ee5043141412e839945afe2f9";

export const isHash = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);

// ---- SHA-256 core ----
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const W = new Int32Array(64);

/** Process one 64-byte block (first 16 words of W must be filled) into state. */
function compress(s) {
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  s[0] = (s[0] + a) | 0; s[1] = (s[1] + b) | 0; s[2] = (s[2] + c) | 0; s[3] = (s[3] + d) | 0;
  s[4] = (s[4] + e) | 0; s[5] = (s[5] + f) | 0; s[6] = (s[6] + g) | 0; s[7] = (s[7] + h) | 0;
}

const hexVal = (c) => (c <= 57 ? c - 48 : (c | 32) - 87);
const HEX = "0123456789abcdef";
const toHex = (s) => {
  let out = "";
  for (let i = 0; i < 8; i++) for (let j = 28; j >= 0; j -= 4) out += HEX[(s[i] >>> j) & 15];
  return out;
};

/** Load 64 ASCII characters into W[0..15]. */
function loadAscii(str) {
  for (let i = 0; i < 16; i++) {
    W[i] = (str.charCodeAt(i * 4) << 24) | (str.charCodeAt(i * 4 + 1) << 16) | (str.charCodeAt(i * 4 + 2) << 8) | str.charCodeAt(i * 4 + 3);
  }
}

const state = new Int32Array(8);

/** Previous round's hash = SHA-256 of this hash as hex text (64 ASCII bytes = 2 blocks). */
export function previousHash(hash) {
  state.set(IV);
  loadAscii(hash.toLowerCase());
  compress(state);
  W.fill(0, 0, 16);
  W[0] = 0x80000000;
  W[15] = 512; // message length in bits
  compress(state);
  return toHex(state);
}

// ---- HMAC-SHA256 with the salt as key ----
// The salt is 64 bytes (one block), so the inner/outer key blocks can be
// processed once per salt and reused for every round.
const hmacCache = new Map();
function hmacStates(salt) {
  let st = hmacCache.get(salt);
  if (!st) {
    const inner = new Int32Array(IV), outer = new Int32Array(IV);
    loadAscii(salt);
    for (let i = 0; i < 16; i++) W[i] ^= 0x36363636;
    compress(inner);
    loadAscii(salt);
    for (let i = 0; i < 16; i++) W[i] ^= 0x5c5c5c5c;
    compress(outer);
    st = { inner, outer };
    hmacCache.set(salt, st);
  }
  return st;
}

/** Crash point: HMAC-SHA256(key = salt, message = hash bytes), first 52 bits -> multiplier. */
export function crashPoint(hash, salt = DEFAULT_SALT) {
  if (salt.length !== 64) throw new Error("Salt must be 64 characters");
  const { inner, outer } = hmacStates(salt);
  // Inner: 32 hash bytes + padding; total length 64 + 32 = 96 bytes.
  state.set(inner);
  for (let i = 0; i < 8; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 4) | hexVal(hash.charCodeAt(i * 8 + j));
    W[i] = v;
  }
  W[8] = 0x80000000;
  W.fill(0, 9, 15);
  W[15] = 96 * 8;
  compress(state);
  // Outer: 32-byte inner digest + padding.
  for (let i = 0; i < 8; i++) W[i] = state[i];
  state.set(outer);
  W[8] = 0x80000000;
  W.fill(0, 9, 15);
  W[15] = 96 * 8;
  compress(state);
  // First 13 hex digits = 32 bits of word 0 + top 20 bits of word 1.
  const r = (state[0] >>> 0) * 2 ** 20 + (state[1] >>> 12);
  let x = r / 2 ** 52;
  x = parseFloat(x.toPrecision(9));
  x = 99 / (1 - x);
  return Math.max(1, Math.floor(x) / 100);
}

/**
 * Rounds from the latest backwards, newest first.
 * Works in chunks so the page stays responsive; onProgress(done, total) is optional.
 */
export async function history(latestHash, count, latestRoundId = null, salt = DEFAULT_SALT, onProgress) {
  const rounds = new Array(count);
  let hash = latestHash.toLowerCase();
  for (let i = 0; i < count; i++) {
    rounds[i] = { roundId: latestRoundId != null ? latestRoundId - i : null, hash, crash: crashPoint(hash, salt) };
    hash = previousHash(hash);
    if (i % 5000 === 4999) {
      onProgress?.(i + 1, count);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(count, count);
  return rounds;
}

/** How many rounds `newer` is ahead of `older` (1..maxSteps), or 0 if not on the same chain. */
export function stepsAhead(newer, older, maxSteps = 200) {
  let h = newer.toLowerCase();
  const target = older.toLowerCase();
  for (let i = 1; i <= maxSteps; i++) {
    h = previousHash(h);
    if (h === target) return i;
  }
  return 0;
}
