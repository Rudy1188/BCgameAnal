// Runs the statistical model off the main thread.
import { analyzeHistory } from "./statmodel.js";

self.onmessage = ({ data }) => {
  try {
    const report = analyzeHistory(data.crashes, data.options, (text) => self.postMessage({ progress: text }));
    self.postMessage({ done: true, report });
  } catch (e) {
    self.postMessage({ error: String(e?.stack || e) });
  }
};
