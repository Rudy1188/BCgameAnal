// Calculates a stretch of the hash chain off the main thread.
// In:  { id, start, count, salt, every }
// Out: progress messages, then { id, done, crashes: Float64Array, checkpoints: [{i, hash}], endHash }
import { crashPoint, previousHash } from "./crash.js";

const cancelled = new Set();

self.onmessage = ({ data }) => {
  if (data.cancel) { cancelled.add(data.cancel); return; }
  const { id, start, count, salt, every = 1000 } = data;
  const crashes = new Float64Array(count);
  const checkpoints = [];
  let h = start;
  for (let i = 0; i < count; i++) {
    if (i % every === 0) checkpoints.push({ i, hash: h });
    crashes[i] = crashPoint(h, salt);
    h = previousHash(h);
    if (i % 50000 === 49999) {
      if (cancelled.has(id)) { cancelled.delete(id); return; }
      self.postMessage({ id, progress: i + 1 });
    }
  }
  self.postMessage({ id, done: true, crashes, checkpoints, endHash: h }, [crashes.buffer]);
};
