/// <reference lib="webworker" />
import type { SolverInput, SolverResult, WorkerSlot } from "../types";

// ─── Shift definitions ────────────────────────────────────────────────────────
//
// Constraint: shifts must NOT start between 00:00–04:59 and must NOT end
// between 00:00–04:59. This gives two valid windows for FT (9h):
//   • Day shifts  : start 05–15  → end 14:00–24:00 (≤ midnight)
//   • Overnight   : start 20–23  → end 05:00–08:00 (≥ 5 AM next day)
//   • Forbidden   : start 16–19  → end 01:00–04:00 (violates end constraint)
//
// For PT (4h), a 4h window can only reach 5 AM from a start ≥ 25 (impossible).
// So PT cannot do overnight: valid starts are 05–20 (end 09–24:00 max).
//
// WFT workers only work Sat+Sun. A Sunday-night overnight would bleed into
// Monday (weekday) — invalid. So WFT stays day-only: 05–15.

const FT_STARTS: number[]  = [5,6,7,8,9,10,11,12,13,14,15, 20,21,22,23]; // day + overnight
const PT_STARTS: number[]  = Array.from({ length: 16 }, (_, i) => i + 5); // [5..20]
const WFT_STARTS: number[] = Array.from({ length: 11 }, (_, i) => i + 5); // [5..15] day only

const FT_BREAK_OFFSETS: number[] = [3, 4]; // break 3 or 4 hours after shift start (staggered)

const MON_FRI: number[] = [0, 1, 2, 3, 4];
const ALL_DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Raw productive hours for an FT worker (shift start s, break offset b).
 * Values ≥ 24 represent hours on the NEXT calendar day
 * (e.g. raw hour 25 = 1 AM next day for an overnight shift starting at 20:00+).
 * The break slot (s+b) is excluded; the other 8 of 9 shift hours are productive.
 */
function ftHoursRaw(s: number, b: number): number[] {
  return Array.from({ length: 9 }, (_, i) => s + i).filter((h) => h !== s + b);
}

/**
 * Same-day productive hours (0–23) for an FT worker.
 * For overnight starts (s ≥ 20) this only returns the hours before midnight.
 */
function ftHours(s: number, b: number): number[] {
  return ftHoursRaw(s, b).filter((h) => h < 24);
}

function ptHours(s: number): number[] {
  return [s, s + 1, s + 2, s + 3];
}

// ─── Variable naming ──────────────────────────────────────────────────────────

function varFT(s: number, p: number, b: number): string  { return `xFT_${s}_${p}_${b}`; }
function varPT(s: number, p: number): string             { return `xPT_${s}_${p}`; }
function varWFT(s: number, b: number): string            { return `xWFT_${s}_${b}`; }
function varWPT(s: number): string                       { return `xWPT_${s}`; }

// ─── LP builder ──────────────────────────────────────────────────────────────
//
// HiGHS WASM MIP solver crashes whenever objective coefficients are non-uniform
// (any value other than 1) — both large integers (54/24) and small ones (2/1)
// trigger Aborted() / memory faults in the WASM binary.
//
// Workaround: two-phase approach, both phases use only coefficient = 1.
//   Phase 1 → minimise total headcount (all-1 objective).
//   Phase 2 → add "total ≤ N_opt" and minimise FT + WFT only (PT/WPT vars
//             absent from objective).  Solver fills remaining budget with
//             part-timers to meet coverage, effectively maximising PT usage.
//
// phase  : 1 = headcount; 2 = min-FT given total cap
// totalCap : only used in phase 2; equals N_opt from phase 1
//
function buildLP(input: SolverInput, phase: 1 | 2 = 1, totalCap = 0): string {
  const { oph, config } = input;
  const rate = config.productivityRate;

  const lines: string[] = [];

  lines.push("Minimize");
  const objTerms: string[] = [];
  if (phase === 1) {
    // Phase 1: minimise total headcount — all variables get coefficient 1
    FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varFT(s, p, b)))));
    PT_STARTS .forEach((s) => MON_FRI.forEach((p) => objTerms.push(varPT(s, p))));
    WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varWFT(s, b))));
    PT_STARTS .forEach((s) => objTerms.push(varWPT(s)));
  } else {
    // Phase 2: minimise FT + WFT (PT/WPT have 0 cost → solver prefers them)
    FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varFT(s, p, b)))));
    WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(varWFT(s, b))));
  }
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

      // ── FT same-day: shift starts on day d and covers hour h ──────────────
      FT_STARTS.forEach((s) => {
        FT_BREAK_OFFSETS.forEach((b) => {
          if (!ftHours(s, b).includes(h)) return;
          MON_FRI.forEach((p) => {
            if (d !== p) terms.push(varFT(s, p, b));
          });
        });
      });

      // ── FT overnight: shift started on prevDay, wraps into hour h on day d ─
      // A worker with overnight start s (≥ 20) whose PREVIOUS day is active
      // will have their shift cover h+24 in the raw productive-hours sequence.
      const prevDay = (d - 1 + 7) % 7;
      FT_STARTS.filter((s) => s >= 20).forEach((s) => {
        FT_BREAK_OFFSETS.forEach((b) => {
          if (!ftHoursRaw(s, b).includes(h + 24)) return;
          // Worker is active on prevDay iff prevDay ≠ their weekday off (p).
          // Even if day d itself is their day off they still finish the
          // overnight shift they started on prevDay.
          MON_FRI.forEach((p) => {
            if (prevDay !== p) terms.push(varFT(s, p, b));
          });
        });
      });

      // ── PT workers (no overnight) ──────────────────────────────────────────
      PT_STARTS.forEach((s) => {
        if (!ptHours(s).includes(h)) return;
        MON_FRI.forEach((p) => {
          if (d !== p) terms.push(varPT(s, p));
        });
      });

      // ── Weekend workers (Sat=5, Sun=6 only, day shifts) ───────────────────
      if (d === 5 || d === 6) {
        WFT_STARTS.forEach((s) => {
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

  // ── Helper collections for cap constraints ─────────────────────────────────
  const allFTVars = (): string[] => {
    const v: string[] = [];
    FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => v.push(varFT(s, p, b)))));
    WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => v.push(varWFT(s, b))));
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
    WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => v.push(varWFT(s, b))));
    PT_STARTS .forEach((s) => v.push(varWPT(s)));
    return v;
  };
  const allWdVars = (): string[] => {
    const v: string[] = [];
    FT_STARTS.forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => v.push(varFT(s, p, b)))));
    PT_STARTS.forEach((s) => MON_FRI.forEach((p) => v.push(varPT(s, p))));
    return v;
  };

  // ── Cap constraints ────────────────────────────────────────────────────────
  // When a cap is 0 we DON'T add individual "xi <= 0" constraint rows —
  // HiGHS WASM crashes when many single-variable constraint rows are present
  // (LP-parser buffer overflow).  Instead we fix those variables to 0 via
  // upper bounds in the Bounds section below (semantically identical).
  // When a cap is between 0 and 100 we emit a single aggregated row using
  // integer coefficients (×100 scaled) to avoid decimal strings.
  const capPt = Math.round(config.partTimerCapPct);
  const capWk = Math.round(config.weekenderCapPct);
  // fixPT: xPT and xWPT bounded to 0;  fixWk: xWFT and xWPT bounded to 0
  const fixPT  = capPt === 0;
  const fixWk  = capWk === 0;
  const fixWPT = fixPT || fixWk;  // WPT is zero if either PT cap or weekender cap is 0

  if (!fixPT && capPt < 100) {
    const ptVars = allPTVars();
    const ftVars = allFTVars();
    const posCoeff = 100 - capPt;
    const negCoeff = capPt;
    const lhs =
      ptVars.map((v) => `${posCoeff} ${v}`).join(" + ") +
      " - " +
      ftVars.map((v) => `${negCoeff} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  if (!fixWk && capWk < 100) {
    const wkVars = allWkVars();
    const wdVars = allWdVars();
    const posCoeff = 100 - capWk;
    const negCoeff = capWk;
    const lhs =
      wkVars.map((v) => `${posCoeff} ${v}`).join(" + ") +
      " - " +
      wdVars.map((v) => `${negCoeff} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  // ── Phase 2 only: total workers ≤ N_optimal from phase 1 ──────────────────
  if (phase === 2 && totalCap > 0) {
    const allVars: string[] = [];
    FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => allVars.push(varFT(s, p, b)))));
    if (!fixPT)  PT_STARTS .forEach((s) => MON_FRI.forEach((p) => allVars.push(varPT(s, p))));
    if (!fixWk)  WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => allVars.push(varWFT(s, b))));
    if (!fixWPT) PT_STARTS .forEach((s) => allVars.push(varWPT(s)));
    conCount++;
    lines.push(` c${conCount}: ${allVars.join(" + ")} <= ${totalCap}`);
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────
  // Variables capped at zero get  0 <= x <= 0  (fixed at 0).
  // All others get  0 <= x  (non-negative, unbounded above).
  lines.push("");
  lines.push("Bounds");
  FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => lines.push(` 0 <= ${varFT(s, p, b)}`))));
  PT_STARTS .forEach((s) => MON_FRI.forEach((p) => lines.push(fixPT  ? ` 0 <= ${varPT(s, p)} <= 0`  : ` 0 <= ${varPT(s, p)}`)));
  WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => lines.push(fixWk  ? ` 0 <= ${varWFT(s, b)} <= 0` : ` 0 <= ${varWFT(s, b)}`)));
  PT_STARTS .forEach((s) => lines.push(fixWPT ? ` 0 <= ${varWPT(s)} <= 0`  : ` 0 <= ${varWPT(s)}`));

  // ── General (integer) ──────────────────────────────────────────────────────
  lines.push("");
  lines.push("General");
  const generals: string[] = [];
  FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => generals.push(varFT(s, p, b)))));
  PT_STARTS .forEach((s) => MON_FRI.forEach((p) => generals.push(varPT(s, p))));
  WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => generals.push(varWFT(s, b))));
  PT_STARTS .forEach((s) => generals.push(varWPT(s)));
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
            // Store mod-24 hours for display. For overnight (s ≥ 20), hours
            // that wrapped past midnight appear as 0–7; coverage logic below
            // uses shiftStart to distinguish same-day vs next-day.
            productiveHours: ftHoursRaw(s, b).map((h) => h % 24),
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

  WFT_STARTS.forEach((s) => {
    FT_BREAK_OFFSETS.forEach((b) => {
      const count = Math.round(solution[varWFT(s, b)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({
          id: id++, type: "WFT",
          shiftStart: s, shiftEnd: s + 9,
          dayOff: null,
          productiveHours: ftHours(s, b), // WFT day-only: all hours < 24
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

  // ── Coverage matrix ─────────────────────────────────────────────────────────
  // For overnight FT workers (shiftStart ≥ 20), productiveHours stored mod-24
  // means any hour h < shiftStart belongs to the NEXT calendar day.
  // For all other worker types, every productive hour ≥ shiftStart (same day).
  const coverage: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  workers.forEach((w) => {
    const activeDays = (w.type === "WFT" || w.type === "WPT")
      ? [5, 6]
      : ALL_DAYS.filter((d) => d !== w.dayOff);
    activeDays.forEach((d) => {
      w.productiveHours.forEach((h) => {
        if (h >= 0 && h < 24) {
          if (h < w.shiftStart) {
            // Overnight wrap: this hour is on the next calendar day
            coverage[(d + 1) % 7][h]++;
          } else {
            coverage[d][h]++;
          }
        }
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
    self.postMessage({ type: "progress", message: "Loading HiGHS solver…" });
    const highsModule = await import("highs");
    const highs = await highsModule.default({
      locateFile: (file: string) => `/${file}`,
    });

    // ── Phase 1: minimise total headcount ──────────────────────────────────
    self.postMessage({ type: "progress", message: "Phase 1 — minimising total headcount…" });
    const t0 = Date.now();
    const lp1 = buildLP(input, 1);
    const r1 = highs.solve(lp1, {});

    if (r1.Status !== "Optimal") {
      const res: SolverResult = {
        status: r1.Status === "Infeasible" ? "infeasible" : "error",
        workers: [], totalWorkers: 0,
        ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
        coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        solveTimeMs: Date.now() - t0,
        errorMessage: `Phase 1 solver status: ${r1.Status}`,
      };
      self.postMessage({ type: "result", payload: res });
      return;
    }

    // Sum all primal values to get the minimum total headcount N_opt
    const cols1 = r1.Columns as Record<string, { Primal: number }>;
    const nOpt = Math.round(
      Object.values(cols1).reduce((sum, col) => sum + col.Primal, 0)
    );

    // ── Phase 2: at fixed total N_opt, minimise FT+WFT → maximise PT usage ─
    self.postMessage({ type: "progress", message: `Phase 2 — maximising part-timer usage (N=${nOpt})…` });
    const lp2 = buildLP(input, 2, nOpt);
    const r2 = highs.solve(lp2, {});
    const solveTimeMs = Date.now() - t0;

    // If phase 2 fails for any reason, fall back to the phase 1 solution
    const result = r2.Status === "Optimal" ? r2 : r1;

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
