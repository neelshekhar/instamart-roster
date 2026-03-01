import type { SolverInput, SolverResult } from "./types";

export type ProgressCallback = (message: string) => void;

/**
 * Run the CP-SAT optimizer via the /api/solve server route.
 * Returns a promise that resolves with the solver result.
 */
export async function runOptimizer(
  input: SolverInput,
  onProgress?: ProgressCallback
): Promise<SolverResult> {
  onProgress?.("Solving with CP-SAT (OR-Tools)…");

  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  onProgress?.("Building roster…");
  return res.json() as Promise<SolverResult>;
}
