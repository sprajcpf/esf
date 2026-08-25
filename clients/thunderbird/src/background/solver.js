/**
 * Worker pool driving the nonce search.
 *
 * Guarantees the UI thread cares about:
 *  - the search never runs on the main thread,
 *  - a job can be cancelled at any time and workers are torn down immediately,
 *  - the pool never spawns more than the configured number of workers.
 */

import { createLogger } from "../utils/log.js";

const log = createLogger("solver");
const WORKER_URL = "/src/workers/powWorker.js";

let jobCounter = 0;

export class PowSolver {
  constructor() {
    /** @type {Map<number, {workers: Worker[], settle: Function}>} */
    this.jobs = new Map();
  }

  /**
   * Searches for a nonce satisfying `bits` leading zero bits.
   *
   * @param {object} options
   * @param {string} options.base preimage base from buildPreimageBase()
   * @param {number} options.bits
   * @param {number} [options.workerCount]
   * @param {(hashes: number) => void} [options.onProgress] total hashes across all workers
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{found: boolean, nonce: string|null, hash: string|null, hashes: number,
   *                    cancelled: boolean, elapsedMs: number}>}
   */
  solve({ base, bits, workerCount = 2, onProgress, signal }) {
    const jobId = ++jobCounter;
    const startedAt = Date.now();
    const count = Math.max(1, workerCount);
    const perWorkerHashes = new Array(count).fill(0);
    let finished = false;

    return new Promise(resolve => {
      const workers = [];

      const totalHashes = () => perWorkerHashes.reduce((sum, value) => sum + value, 0);

      const finish = outcome => {
        if (finished) {
          return;
        }
        finished = true;
        this.#teardown(jobId);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve({ hashes: totalHashes(), elapsedMs: Date.now() - startedAt, ...outcome });
      };

      const onAbort = () => finish({ found: false, nonce: null, hash: null, cancelled: true });

      for (let index = 0; index < count; index++) {
        let worker;
        try {
          worker = new Worker(WORKER_URL, { type: "module" });
        } catch (error) {
          log.error("cannot start worker", error);
          break;
        }
        worker.addEventListener("message", event => {
          const message = event.data;
          if (!message || message.jobId !== jobId) {
            return;
          }
          if (message.type === "progress") {
            perWorkerHashes[index] = message.hashes;
            if (onProgress) {
              onProgress(totalHashes());
            }
            return;
          }
          if (message.type === "found") {
            perWorkerHashes[index] = message.hashes;
            finish({ found: true, nonce: message.nonce, hash: message.hash, cancelled: false });
            return;
          }
          if (message.type === "error") {
            log.error("worker error", message.message);
            finish({ found: false, nonce: null, hash: null, cancelled: true, error: message.message });
          }
        });
        worker.addEventListener("error", error => {
          log.error("worker failed", error.message || error);
          finish({ found: false, nonce: null, hash: null, cancelled: true, error: String(error.message || error) });
        });
        worker.postMessage({ type: "solve", jobId, base, bits, startNonce: index, stride: count, batchSize: 5000 });
        workers.push(worker);
      }

      if (workers.length === 0) {
        finish({ found: false, nonce: null, hash: null, cancelled: true, error: "no workers available" });
        return;
      }

      this.jobs.set(jobId, { workers });

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  /** Cancels every running job. */
  cancelAll() {
    for (const jobId of [...this.jobs.keys()]) {
      this.#teardown(jobId);
    }
  }

  #teardown(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    this.jobs.delete(jobId);
    for (const worker of job.workers) {
      // Terminate rather than politely cancel: it stops the CPU work in the same tick.
      worker.terminate();
    }
  }
}
