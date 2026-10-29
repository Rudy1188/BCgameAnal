// Holds the calculated history for the saved latest round, newest first.
// Only crash points are kept (Float64Array), plus the hash of every 1000th
// round, so even millions of rounds use little memory. Any round's hash is
// rebuilt from the nearest saved one.
import { crashPoint, previousHash, stepsAhead } from "./crash.js";

const EVERY = 1000;

export class Chain {
  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => this.jobs.get(data.id)?.(data);
    this.jobs = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.gen = 0;
    this.clear();
  }

  clear() {
    this.gen++;
    this.latest = null;
    this.buf = new Float64Array(0);
    this.length = 0;
    this.checkpoints = [];
    this.tailHash = null; // hash of the next (older) round to calculate
  }

  /** Crash points calculated so far, newest first. */
  get crashes() { return this.buf.subarray(0, this.length); }

  /**
   * Point at a (new) latest round. If it continues the current chain, only the
   * new rounds are calculated; otherwise everything starts over.
   */
  setLatest(latest) {
    if (!latest) return this.clear();
    const old = this.latest;
    if (old && old.salt === latest.salt) {
      if (old.hash === latest.hash) return;
      const k = this.length ? stepsAhead(latest.hash, old.hash, 2000) : 0;
      if (k > 0) {
        const fresh = new Float64Array(k);
        let h = latest.hash;
        for (let i = 0; i < k; i++) { fresh[i] = crashPoint(h, latest.salt); h = previousHash(h); }
        this.ensure(this.length + k);
        this.buf.copyWithin(k, 0, this.length);
        this.buf.set(fresh, 0);
        this.length += k;
        for (const c of this.checkpoints) c.i += k;
        this.checkpoints.unshift({ i: 0, hash: latest.hash });
        this.latest = { ...latest, roundId: latest.roundId ?? (old.roundId != null ? old.roundId + k : null) };
        return;
      }
    }
    this.clear();
    this.latest = { ...latest };
    this.tailHash = latest.hash.toLowerCase();
  }

  ensure(n) {
    if (n <= this.buf.length) return;
    const next = new Float64Array(Math.max(n, this.buf.length * 2, 4096));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  /** Calculate until at least `n` rounds exist. onProgress(done, total). */
  extendTo(n, onProgress) {
    this.queue = this.queue.then(() => this.#extend(n, onProgress)).catch((e) => console.error(e));
    return this.queue;
  }

  async #extend(n, onProgress) {
    if (!this.latest || n <= this.length) return;
    const gen = this.gen;
    const startLen = this.length;
    const count = n - startLen;
    const id = this.nextId++;
    const result = await new Promise((resolve) => {
      this.jobs.set(id, (msg) => {
        if (this.gen !== gen) { this.worker.postMessage({ cancel: id }); this.jobs.delete(id); resolve(null); return; }
        if (msg.progress) onProgress?.(startLen + msg.progress, n);
        if (msg.done) { this.jobs.delete(id); resolve(msg); }
      });
      this.worker.postMessage({ id, start: this.tailHash, count, salt: this.latest.salt, every: EVERY });
    });
    if (!result || this.gen !== gen) return;
    // New rounds may have been added at the front meanwhile; append at the current end.
    const base = this.length;
    this.ensure(base + count);
    this.buf.set(result.crashes, base);
    for (const c of result.checkpoints) this.checkpoints.push({ i: base + c.i, hash: c.hash });
    this.length = base + count;
    this.tailHash = result.endHash;
    onProgress?.(this.length, this.length);
  }

  roundIdAt(i) {
    return this.latest?.roundId != null ? this.latest.roundId - i : null;
  }

  /** Hash of round `i` (0 = newest), rebuilt from the nearest saved hash. */
  hashAt(i) {
    let best = null;
    for (const c of this.checkpoints) if (c.i <= i && (!best || c.i > best.i)) best = c;
    if (!best) return null;
    let h = best.hash;
    for (let k = best.i; k < i; k++) h = previousHash(h);
    return h;
  }
}
