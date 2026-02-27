import type { SolverInput, SolverResult } from "./types";

export type ProgressCallback = (message: string) => void;

/**
 * Run the ILP optimizer in a Web Worker.
 * Returns a promise that resolves with the solver result.
 */
export function runOptimizer(
  input: SolverInput,
  onProgress?: ProgressCallback
): Promise<SolverResult> {
  return new Promise((resolve, reject) => {
    // Create the worker using Next.js web worker convention
    const worker = new Worker(
      new URL("./workers/solver.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type, payload, message } = e.data;
      if (type === "progress") {
        onProgress?.(message);
      } else if (type === "result") {
        worker.terminate();
        resolve(payload as SolverResult);
      } else if (type === "error") {
        worker.terminate();
        reject(new Error(message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`Worker error: ${err.message}`));
    };

    worker.postMessage({ type: "solve", payload: input });
  });
}
