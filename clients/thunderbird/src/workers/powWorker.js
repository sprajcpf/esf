/**
 * Nonce search worker. One instance searches a single shard of the nonce space (startNonce + k * stride) so that N
 * workers never duplicate work. Runs as an ES module worker.
 *
 * Protocol:
 *   in  { type: "solve", jobId, base, bits, startNonce, stride, batchSize }
 *   in  { type: "cancel", jobId }
 *   out { type: "progress", jobId, hashes }
 *   out { type: "found", jobId, nonce, hash, hashes }
 *   out { type: "cancelled" | "error", jobId, ... }
 */

import { searchNonce } from "../protocol/pow.js";

let cancelledJobs = new Set();

self.addEventListener("message", async event => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "cancel") {
    cancelledJobs.add(message.jobId);
    return;
  }
  if (message.type !== "solve") {
    return;
  }

  const { jobId, base, bits, startNonce, stride, batchSize } = message;
  cancelledJobs.delete(jobId);
  try {
    const result = await searchNonce({
      base,
      bits,
      startNonce,
      stride,
      batchSize,
      shouldStop: () => cancelledJobs.has(jobId),
      onProgress: hashes => self.postMessage({ type: "progress", jobId, hashes })
    });
    if (result.found) {
      self.postMessage({ type: "found", jobId, nonce: result.nonce, hash: result.hash, hashes: result.hashes });
    } else {
      self.postMessage({ type: "cancelled", jobId, hashes: result.hashes });
    }
  } catch (error) {
    self.postMessage({ type: "error", jobId, message: String(error && error.message ? error.message : error) });
  } finally {
    cancelledJobs.delete(jobId);
  }
});
