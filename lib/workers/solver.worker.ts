/// <reference lib="webworker" />
import type { SolverInput, SolverResult, WorkerSlot } from "../types";

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
  const alpha = config.partTimerCapPct / 100;
  const beta = config.weekenderCapPct / 100;

  const lines: string[] = [];

  // ── Objective ──────────────────────────────────────────────────────────────
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

  // ── Coverage constraints ───────────────────────────────────────────────────
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const demand = oph[d][h];
      if (demand <= 0) continue;
      const required = Math.ceil(demand / rate);

      const terms: string[] = [];

      FT_STARTS.forEach((s) => {
        if (!ftHours(s).includes(h)) return;
        MON_FRI.forEach((p) => {
          if (d !== p) terms.push(varFT(s, p));
        });
      });

      PT_STARTS.forEach((s) => {
        if (!ptHours(s).includes(h)) return;
        MON_FRI.forEach((p) => {
          if (d !== p) terms.push(varPT(s, p));
        });
      });

      if (d === 5 || d === 6) {
        FT_STARTS.forEach((s) => {
          if (ftHours(s).includes(h)) terms.push(varWFT(s));
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

  // ── PT cap ─────────────────────────────────────────────────────────────────
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

  // ── Weekender cap ──────────────────────────────────────────────────────────
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

  // ── Bounds ─────────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("Bounds");
  FT_STARTS.forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varFT(s, p)}`)));
  PT_STARTS.forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varPT(s, p)}`)));
  FT_STARTS.forEach((s) => lines.push(` 0 <= ${varWFT(s)}`));
  PT_STARTS.forEach((s) => lines.push(` 0 <= ${varWPT(s)}`));

  // ── General (integer) ──────────────────────────────────────────────────────
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
      const count = Math.round(solution[varFT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({ id: id++, type: "FT", shiftStart: s, shiftEnd: s + 9, dayOff: p as 0|1|2|3|4, productiveHours: ftHours(s) });
        ftCount++;
      }
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
    const count = Math.round(solution[varWFT(s)] ?? 0);
    for (let i = 0; i < count; i++) {
      workers.push({ id: id++, type: "WFT", shiftStart: s, shiftEnd: s + 9, dayOff: null, productiveHours: ftHours(s) });
      wftCount++;
    }
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
    const activeDays =
      w.type === "WFT" || w.type === "WPT"
        ? [5, 6]
        : ALL_DAYS.filter((d) => d !== w.dayOff);
    activeDays.forEach((d) => {
      w.productiveHours.forEach((h) => {
        if (h >= 0 && h < 24) coverage[d][h]++;
      });
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

    // Dynamic import — works in ESM module workers (Next.js webpack bundles this correctly).
    // We use locateFile so HiGHS can find highs.wasm served from /public in all environments.
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
        workers: [],
        totalWorkers: 0,
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
