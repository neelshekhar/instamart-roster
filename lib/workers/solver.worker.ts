/// <reference lib="webworker" />
import type { SolverInput, SolverResult, WorkerSlot, WorkerType } from "../types";

// ─── Shift definitions ────────────────────────────────────────────────────────

// Full-time: 9h slot, 8h productive (break after hour 4 of shift)
// Valid starts: 5..15 (latest end = 15+9=24, i.e. midnight)
const FT_STARTS: number[] = Array.from({ length: 11 }, (_, i) => i + 5); // [5..15]

// Part-time: 4h straight, no break
// Valid starts: 5..20 (latest end = 20+4=24)
const PT_STARTS: number[] = Array.from({ length: 16 }, (_, i) => i + 5); // [5..20]

// Weekday-off options for FT/PT workers (Mon=0 … Fri=4)
const MON_FRI: number[] = [0, 1, 2, 3, 4];

// All days Mon..Sun = 0..6
const ALL_DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/** Productive hours for FT given shift start s */
function ftHours(s: number): number[] {
  return [s, s + 1, s + 2, s + 3, s + 5, s + 6, s + 7, s + 8];
}

/** Productive hours for PT given shift start s */
function ptHours(s: number): number[] {
  return [s, s + 1, s + 2, s + 3];
}

// ─── Variable naming helpers ──────────────────────────────────────────────────

// Variables:
// FT:  xFT_s_p  (s = start, p = day-off 0..4)
// PT:  xPT_s_p
// WFT: xWFT_s   (weekender FT, always off Mon–Fri)
// WPT: xWPT_s

function varFT(s: number, p: number): string {
  return `xFT_${s}_${p}`;
}
function varPT(s: number, p: number): string {
  return `xPT_${s}_${p}`;
}
function varWFT(s: number): string {
  return `xWFT_${s}`;
}
function varWPT(s: number): string {
  return `xWPT_${s}`;
}

// ─── LP builder ──────────────────────────────────────────────────────────────

function buildLP(input: SolverInput): string {
  const { oph, config } = input;
  const rate = config.productivityRate;
  const alpha = config.partTimerCapPct / 100;   // PT cap fraction
  const beta = config.weekenderCapPct / 100;     // Weekender cap fraction

  const lines: string[] = [];

  // ── Objective: minimize total headcount ──────────────────────────────────
  lines.push("Minimize");
  const objTerms: string[] = [];
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => objTerms.push(varFT(s, p))));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => objTerms.push(varPT(s, p))));
  FT_STARTS.forEach((s) => objTerms.push(varWFT(s)));
  PT_STARTS.forEach((s) => objTerms.push(varWPT(s)));
  lines.push(" obj: " + objTerms.join(" + "));

  lines.push("");
  lines.push("Subject To");

  let conCount = 0;

  // ── Coverage constraints ─────────────────────────────────────────────────
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const demand = oph[d][h];
      if (demand <= 0) continue;
      const required = Math.ceil(demand / rate);

      const terms: string[] = [];

      // FT workers: active on all days except day-off p
      // Worker is active on day d if d !== p (for p in MON_FRI)
      // On weekends (d=5,6), FT is always active (no day-off on weekends)
      FT_STARTS.forEach((s) => {
        const hours = ftHours(s);
        if (!hours.includes(h)) return;
        MON_FRI.forEach((p) => {
          // This worker's day off is p
          // Active on day d if d !== p
          if (d !== p) {
            terms.push(varFT(s, p));
          }
        });
      });

      // PT workers: same logic as FT but with PT hours
      PT_STARTS.forEach((s) => {
        const hours = ptHours(s);
        if (!hours.includes(h)) return;
        MON_FRI.forEach((p) => {
          if (d !== p) {
            terms.push(varPT(s, p));
          }
        });
      });

      // WFT: only active Sat(5) and Sun(6)
      if (d === 5 || d === 6) {
        FT_STARTS.forEach((s) => {
          const hours = ftHours(s);
          if (hours.includes(h)) {
            terms.push(varWFT(s));
          }
        });
      }

      // WPT: only active Sat(5) and Sun(6)
      if (d === 5 || d === 6) {
        PT_STARTS.forEach((s) => {
          const hours = ptHours(s);
          if (hours.includes(h)) {
            terms.push(varWPT(s));
          }
        });
      }

      if (terms.length === 0) continue; // no workers can cover this slot

      conCount++;
      lines.push(` c${conCount}: ${terms.join(" + ")} >= ${required}`);
    }
  }

  // ── PT cap constraint ────────────────────────────────────────────────────
  // alpha*(FT+WFT) >= (1-alpha)*(PT+WPT)
  // Rearranged: (1-alpha)*(PT+WPT) - alpha*(FT+WFT) <= 0
  if (alpha > 0 && alpha < 1) {
    const ptCapTerms: string[] = [];
    PT_STARTS.forEach((s) =>
      MON_FRI.forEach((p) => ptCapTerms.push(`${(1 - alpha).toFixed(6)} ${varPT(s, p)}`))
    );
    PT_STARTS.forEach((s) => ptCapTerms.push(`${(1 - alpha).toFixed(6)} ${varWPT(s)}`));
    FT_STARTS.forEach((s) =>
      MON_FRI.forEach((p) => ptCapTerms.push(`${(-alpha).toFixed(6)} ${varFT(s, p)}`))
    );
    FT_STARTS.forEach((s) => ptCapTerms.push(`${(-alpha).toFixed(6)} ${varWFT(s)}`));
    conCount++;
    lines.push(` c${conCount}: ${ptCapTerms.join(" + ")} <= 0`);
  }

  // ── Weekender cap constraint ─────────────────────────────────────────────
  // beta*(FT+PT) >= (1-beta)*(WFT+WPT)
  // Rearranged: (1-beta)*(WFT+WPT) - beta*(FT+PT) <= 0
  if (beta > 0 && beta < 1) {
    const wkCapTerms: string[] = [];
    FT_STARTS.forEach((s) => wkCapTerms.push(`${(1 - beta).toFixed(6)} ${varWFT(s)}`));
    PT_STARTS.forEach((s) => wkCapTerms.push(`${(1 - beta).toFixed(6)} ${varWPT(s)}`));
    FT_STARTS.forEach((s) =>
      MON_FRI.forEach((p) => wkCapTerms.push(`${(-beta).toFixed(6)} ${varFT(s, p)}`))
    );
    PT_STARTS.forEach((s) =>
      MON_FRI.forEach((p) => wkCapTerms.push(`${(-beta).toFixed(6)} ${varPT(s, p)}`))
    );
    conCount++;
    lines.push(` c${conCount}: ${wkCapTerms.join(" + ")} <= 0`);
  }

  // ── Bounds: all variables >= 0 (default, stated explicitly) ─────────────
  lines.push("");
  lines.push("Bounds");
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varFT(s, p)}`)));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varPT(s, p)}`)));
  FT_STARTS.forEach((s) => lines.push(` 0 <= ${varWFT(s)}`));
  PT_STARTS.forEach((s) => lines.push(` 0 <= ${varWPT(s)}`));

  // ── Integer declarations ─────────────────────────────────────────────────
  lines.push("");
  lines.push("General");
  const generals: string[] = [];
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => generals.push(varFT(s, p))));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => generals.push(varPT(s, p))));
  FT_STARTS.forEach((s) => generals.push(varWFT(s)));
  PT_STARTS.forEach((s) => generals.push(varWPT(s)));
  lines.push(" " + generals.join(" "));

  lines.push("");
  lines.push("End");

  return lines.join("\n");
}

// ─── Roster builder ──────────────────────────────────────────────────────────

function buildRoster(
  solution: Record<string, number>,
  oph: number[][]
): {
  workers: WorkerSlot[];
  coverage: number[][];
  required: number[][];
  ftCount: number;
  ptCount: number;
  wftCount: number;
  wptCount: number;
} {
  const workers: WorkerSlot[] = [];
  let id = 1;
  let ftCount = 0;
  let ptCount = 0;
  let wftCount = 0;
  let wptCount = 0;

  // FT workers
  FT_STARTS.forEach((s) => {
    MON_FRI.forEach((p) => {
      const count = Math.round(solution[varFT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({
          id: id++,
          type: "FT",
          shiftStart: s,
          shiftEnd: s + 9,
          dayOff: p as 0 | 1 | 2 | 3 | 4,
          productiveHours: ftHours(s),
        });
        ftCount++;
      }
    });
  });

  // PT workers
  PT_STARTS.forEach((s) => {
    MON_FRI.forEach((p) => {
      const count = Math.round(solution[varPT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({
          id: id++,
          type: "PT",
          shiftStart: s,
          shiftEnd: s + 4,
          dayOff: p as 0 | 1 | 2 | 3 | 4,
          productiveHours: ptHours(s),
        });
        ptCount++;
      }
    });
  });

  // WFT workers
  FT_STARTS.forEach((s) => {
    const count = Math.round(solution[varWFT(s)] ?? 0);
    for (let i = 0; i < count; i++) {
      workers.push({
        id: id++,
        type: "WFT",
        shiftStart: s,
        shiftEnd: s + 9,
        dayOff: null,
        productiveHours: ftHours(s),
      });
      wftCount++;
    }
  });

  // WPT workers
  PT_STARTS.forEach((s) => {
    const count = Math.round(solution[varWPT(s)] ?? 0);
    for (let i = 0; i < count; i++) {
      workers.push({
        id: id++,
        type: "WPT",
        shiftStart: s,
        shiftEnd: s + 4,
        dayOff: null,
        productiveHours: ptHours(s),
      });
      wptCount++;
    }
  });

  // Compute coverage matrix
  const coverage: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const required: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));

  // Fill required
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      required[d][h] = oph[d][h] > 0 ? 1 : 0; // will be overridden below if needed
    }
  }

  // Fill coverage by replaying worker assignments
  workers.forEach((w) => {
    const activeDays =
      w.type === "WFT" || w.type === "WPT"
        ? [5, 6]
        : ALL_DAYS.filter((d) => d !== w.dayOff);

    activeDays.forEach((d) => {
      w.productiveHours.forEach((h) => {
        if (h >= 0 && h < 24) {
          coverage[d][h]++;
        }
      });
    });
  });

  return { workers, coverage, required, ftCount, ptCount, wftCount, wptCount };
}

// ─── Worker message handler ───────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type !== "solve") return;

  const input = payload as SolverInput;

  try {
    self.postMessage({ type: "progress", message: "Building LP model…" });

    const lpString = buildLP(input);

    self.postMessage({ type: "progress", message: "Loading HiGHS solver…" });

    // Dynamic import of highs-js (loads WASM)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const highsModule = await (self as any).importScripts
      ? null
      : await import("highs");

    let highs: any;
    if (highsModule) {
      highs = await highsModule.default({});
    } else {
      // fallback for importScripts-based workers
      throw new Error("ESM import required");
    }

    self.postMessage({ type: "progress", message: "Solving ILP (this may take a moment)…" });

    const t0 = Date.now();
    const result = highs.solve(lpString, {});
    const solveTimeMs = Date.now() - t0;

    if (result.Status !== "Optimal") {
      const res: SolverResult = {
        status: result.Status === "Infeasible" ? "infeasible" : "error",
        workers: [],
        totalWorkers: 0,
        ftCount: 0,
        ptCount: 0,
        wftCount: 0,
        wptCount: 0,
        coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        solveTimeMs,
        errorMessage: `Solver status: ${result.Status}`,
      };
      self.postMessage({ type: "result", payload: res });
      return;
    }

    self.postMessage({ type: "progress", message: "Building roster from solution…" });

    const solution: Record<string, number> = {};
    for (const [name, col] of Object.entries(result.Columns as Record<string, { Primal: number }>)) {
      solution[name] = col.Primal;
    }

    const { workers, coverage, required, ftCount, ptCount, wftCount, wptCount } =
      buildRoster(solution, input.oph);

    // Build proper required matrix from OPH
    const rate = input.config.productivityRate;
    const reqMatrix: number[][] = input.oph.map((row) =>
      row.map((v) => (v > 0 ? Math.ceil(v / rate) : 0))
    );

    const resultPayload: SolverResult = {
      status: "optimal",
      workers,
      totalWorkers: workers.length,
      ftCount,
      ptCount,
      wftCount,
      wptCount,
      coverage,
      required: reqMatrix,
      solveTimeMs,
    };

    self.postMessage({ type: "result", payload: resultPayload });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", message });
  }
};
