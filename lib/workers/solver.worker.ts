/// <reference lib="webworker" />
import type { SolverInput, SolverResult, WorkerSlot } from "../types";

// ─── Shift definitions ────────────────────────────────────────────────────────

// Full-time: 9h shift, 8h productive.
// Break can be taken after completing 3 hours OR after 4 hours (staggered).
// Break offsets relative to shift start: 3 or 4.
const FT_STARTS: number[] = Array.from({ length: 11 }, (_, i) => i + 5); // [5..15]
const FT_BREAK_OFFSETS: number[] = [3, 4]; // break at s+3 or s+4

// Part-time: 4h straight, no break.
const PT_STARTS: number[] = Array.from({ length: 16 }, (_, i) => i + 5); // [5..20]

const MON_FRI: number[] = [0, 1, 2, 3, 4];
const ALL_DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Productive hours for an FT worker given shift start s and break offset b.
 * The break hour (s+b) is excluded; all other 8 of the 9 shift hours are productive.
 */
function ftHours(s: number, b: number): number[] {
  return Array.from({ length: 9 }, (_, i) => s + i).filter((h) => h !== s + b);
}

function ptHours(s: number): number[] {
  return [s, s + 1, s + 2, s + 3];
}

// ─── Variable naming ──────────────────────────────────────────────────────────
// FT/WFT now have a break-offset dimension (b = 3 or 4).

function varFT(s: number, p: number, b: number): string {
  return `xFT_${s}_${p}_${b}`;
}
function varPT(s: number, p: number): string {
  return `xPT_${s}_${p}`;
}
function varWFT(s: number, b: number): string {
  return `xWFT_${s}_${b}`;
}
function varWPT(s: number): string {
  return `xWPT_${s}`;
}

// ─── LP builder ──────────────────────────────────────────────────────────────

function buildLP(input: SolverInput): string {
  const { oph, config } = input;
  const rate = config.productivityRate;
  const alpha = config.partTimerCapPct / 100;
  const beta = config.weekenderCapPct / 100;

  const lines: string[] = [];

  // ── Objective: minimize total headcount ────────────────────────────────────
  lines.push("Minimize");
  const objTerms: string[] = [];
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varFT(s, p, b)))));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => objTerms.push(varPT(s, p))));
  FT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varWFT(s, b))));
  PT_STARTS.forEach((s) => objTerms.push(varWPT(s)));
  lines.push(" obj: " + objTerms.join(" + "));

  lines.push("");
  lines.push("Subject To");

  let conCount = 0;

  // ── Coverage constraints ───────────────────────────────────────────────────
  // For each (day, hour) with positive demand, the sum of workers covering
  // that slot must meet the required headcount.
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const demand = oph[d][h];
      if (demand <= 0) continue;
      const required = Math.ceil(demand / rate);
      const terms: string[] = [];

      // FT workers (each break option separately)
      FT_STARTS.forEach((s) => {
        FT_BREAK_OFFSETS.forEach((b) => {
          if (!ftHours(s, b).includes(h)) return;
          MON_FRI.forEach((p) => {
            if (d !== p) terms.push(varFT(s, p, b));
          });
        });
      });

      // PT workers
      PT_STARTS.forEach((s) => {
        if (!ptHours(s).includes(h)) return;
        MON_FRI.forEach((p) => {
          if (d !== p) terms.push(varPT(s, p));
        });
      });

      // Weekend workers (Sat=5, Sun=6 only)
      if (d === 5 || d === 6) {
        FT_STARTS.forEach((s) => {
          FT_BREAK_OFFSETS.forEach((b) => {
            if (ftHours(s, b).includes(h)) terms.push(varWFT(s, b));
          });
        });
        PT_STARTS.forEach((s) => {
          if (ptHours(s).includes(h)) terms.push(varWPT(s));
        });
      }

      if (terms.length === 0) continue;
      conCount++;
      lines.push(` c${conCount}: ${terms.join(" + ")} >= ${required}`);
    }
  }

  // ── Helper: collect all FT vars and all PT vars (both break offsets for FT) ──
  const allFTVars = (): string[] => {
    const v: string[] = [];
    FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => v.push(varFT(s, p, b)))));
    FT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => v.push(varWFT(s, b))));
    return v;
  };
  const allPTVars = (): string[] => {
    const v: string[] = [];
    PT_STARTS.forEach((s) => MON_FRI.forEach((p) => v.push(varPT(s, p))));
    PT_STARTS.forEach((s) => v.push(varWPT(s)));
    return v;
  };
  const allWkVars = (): string[] => {
    const v: string[] = [];
    FT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => v.push(varWFT(s, b))));
    PT_STARTS.forEach((s) => v.push(varWPT(s)));
    return v;
  };
  const allWdVars = (): string[] => {
    const v: string[] = [];
    FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => v.push(varFT(s, p, b)))));
    PT_STARTS.forEach((s) => MON_FRI.forEach((p) => v.push(varPT(s, p))));
    return v;
  };

  // ── PT cap ─────────────────────────────────────────────────────────────────
  if (alpha < 1) {
    const ptVars = allPTVars();
    if (alpha === 0) {
      ptVars.forEach((v) => { conCount++; lines.push(` c${conCount}: ${v} <= 0`); });
    } else {
      const ftVars = allFTVars();
      const terms = [
        ...ptVars.map((v) => `${(1 - alpha).toFixed(6)} ${v}`),
        ...ftVars.map((v) => `${(-alpha).toFixed(6)} ${v}`),
      ];
      conCount++;
      lines.push(` c${conCount}: ${terms.join(" + ")} <= 0`);
    }
  }

  // ── Weekender cap ──────────────────────────────────────────────────────────
  if (beta < 1) {
    const wkVars = allWkVars();
    if (beta === 0) {
      wkVars.forEach((v) => { conCount++; lines.push(` c${conCount}: ${v} <= 0`); });
    } else {
      const wdVars = allWdVars();
      const terms = [
        ...wkVars.map((v) => `${(1 - beta).toFixed(6)} ${v}`),
        ...wdVars.map((v) => `${(-beta).toFixed(6)} ${v}`),
      ];
      conCount++;
      lines.push(` c${conCount}: ${terms.join(" + ")} <= 0`);
    }
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("Bounds");
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => lines.push(` 0 <= ${varFT(s, p, b)}`))));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varPT(s, p)}`)));
  FT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => lines.push(` 0 <= ${varWFT(s, b)}`)));
  PT_STARTS.forEach((s) => lines.push(` 0 <= ${varWPT(s)}`));

  // ── General (integer) ──────────────────────────────────────────────────────
  lines.push("");
  lines.push("General");
  const generals: string[] = [];
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => generals.push(varFT(s, p, b)))));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => generals.push(varPT(s, p))));
  FT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => generals.push(varWFT(s, b))));
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
  ftCount: number;
  ptCount: number;
  wftCount: number;
  wptCount: number;
} {
  const workers: WorkerSlot[] = [];
  let id = 1;
  let ftCount = 0, ptCount = 0, wftCount = 0, wptCount = 0;

  FT_STARTS.forEach((s) => {
    MON_FRI.forEach((p) => {
      FT_BREAK_OFFSETS.forEach((b) => {
        const count = Math.round(solution[varFT(s, p, b)] ?? 0);
        for (let i = 0; i < count; i++) {
          workers.push({
            id: id++, type: "FT",
            shiftStart: s, shiftEnd: s + 9,
            dayOff: p as 0|1|2|3|4,
            productiveHours: ftHours(s, b),
          });
          ftCount++;
        }
      });
    });
  });

  PT_STARTS.forEach((s) => {
    MON_FRI.forEach((p) => {
      const count = Math.round(solution[varPT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({ id: id++, type: "PT", shiftStart: s, shiftEnd: s + 4, dayOff: p as 0|1|2|3|4, productiveHours: ptHours(s) });
        ptCount++;
      }
    });
  });

  FT_STARTS.forEach((s) => {
    FT_BREAK_OFFSETS.forEach((b) => {
      const count = Math.round(solution[varWFT(s, b)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({
          id: id++, type: "WFT",
          shiftStart: s, shiftEnd: s + 9,
          dayOff: null,
          productiveHours: ftHours(s, b),
        });
        wftCount++;
      }
    });
  });

  PT_STARTS.forEach((s) => {
    const count = Math.round(solution[varWPT(s)] ?? 0);
    for (let i = 0; i < count; i++) {
      workers.push({ id: id++, type: "WPT", shiftStart: s, shiftEnd: s + 4, dayOff: null, productiveHours: ptHours(s) });
      wptCount++;
    }
  });

  // Coverage matrix
  const coverage: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  workers.forEach((w) => {
    const activeDays = (w.type === "WFT" || w.type === "WPT")
      ? [5, 6]
      : ALL_DAYS.filter((d) => d !== w.dayOff);
    activeDays.forEach((d) => {
      w.productiveHours.forEach((h) => { if (h >= 0 && h < 24) coverage[d][h]++; });
    });
  });

  return { workers, coverage, ftCount, ptCount, wftCount, wptCount };
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

    const highsModule = await import("highs");
    const highs = await highsModule.default({
      locateFile: (file: string) => `/${file}`,
    });

    self.postMessage({ type: "progress", message: "Solving ILP (this may take a moment)…" });

    const t0 = Date.now();
    const result = highs.solve(lpString, {});
    const solveTimeMs = Date.now() - t0;

    if (result.Status !== "Optimal") {
      const res: SolverResult = {
        status: result.Status === "Infeasible" ? "infeasible" : "error",
        workers: [], totalWorkers: 0,
        ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
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

    const { workers, coverage, ftCount, ptCount, wftCount, wptCount } =
      buildRoster(solution, input.oph);

    const rate = input.config.productivityRate;
    const reqMatrix: number[][] = input.oph.map((row) =>
      row.map((v) => (v > 0 ? Math.ceil(v / rate) : 0))
    );

    const resultPayload: SolverResult = {
      status: "optimal",
      workers,
      totalWorkers: workers.length,
      ftCount, ptCount, wftCount, wptCount,
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
