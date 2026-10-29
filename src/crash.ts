import { createHash, createHmac } from "node:crypto";

// BC.Game Crash provably-fair calculation.
// Checked against round 9745447: hash 0ab60395...0b7e -> 8.17x.

export const DEFAULT_SALT =
  "000000000000000000010283162e089cc99f643ee5043141412e839945afe2f9";

export interface Round {
  roundId: number | null;
  hash: string;
  crash: number;
}

/** Crash point for one round's hash. */
export function crashPoint(hash: string, salt = DEFAULT_SALT): number {
  // HMAC-SHA256 with the salt as key and the hash bytes as message.
  const hmac = createHmac("sha256", salt).update(Buffer.from(hash, "hex")).digest("hex");
  // First 52 bits -> number in [0, 1).
  const r = parseInt(hmac.slice(0, 13), 16);
  let x = r / 2 ** 52;
  x = parseFloat(x.toPrecision(9));
  x = 99 / (1 - x);
  return Math.max(1, Math.floor(x) / 100);
}

/** The previous round's hash is SHA-256 of this round's hash (as hex text). */
export function previousHash(hash: string): string {
  return createHash("sha256").update(hash).digest("hex");
}

/** Walk back from the latest hash: returns `count` rounds, newest first. */
export function history(latestHash: string, count: number, latestRoundId?: number, salt = DEFAULT_SALT): Round[] {
  const rounds: Round[] = [];
  let hash = latestHash.trim().toLowerCase();
  for (let i = 0; i < count; i++) {
    rounds.push({
      roundId: latestRoundId != null ? latestRoundId - i : null,
      hash,
      crash: crashPoint(hash, salt),
    });
    hash = previousHash(hash);
  }
  return rounds;
}

export const isHash = (s: string) => /^[0-9a-f]{64}$/i.test(s.trim());
