// Usage: npm run calc -- <latestHash> [count] [latestRoundId]
import { history, isHash } from "./crash.js";

const [hash = "", countArg = "20", roundArg] = process.argv.slice(2);
if (!isHash(hash)) {
  console.error("Usage: npm run calc -- <latestHash> [count] [latestRoundId]");
  process.exit(1);
}

const rounds = history(hash, Number(countArg) || 20, roundArg ? Number(roundArg) : undefined);
for (const r of rounds) {
  console.log(`${String(r.roundId ?? "").padEnd(9)} ${r.crash.toFixed(2).padStart(10)}x  ${r.hash}`);
}
