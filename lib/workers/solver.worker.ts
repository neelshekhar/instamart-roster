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

function buildLP(input: SolverInput): string {
  const { oph, config } = input;
  const rate = config.productivityRate;

  const lines: string[] = [];

  // ── Objective: minimise total weekly labour-hours (small integer weights) ───
  // HiGHS WASM aborts with large-integer (54/24/18/8) or decimal (0.4444…)
  // coefficients due to internal LP-parser buffer issues.  Small plain
  // integers stay well within the stable range (max objective ≈ 400).
  //
  // Weights approximate weekly paid-hour ratios (54 : 24 : 18 : 8 ≈ 2:1:1:0.5).
  // PT costs half an FT → solver actively chooses PT for narrow demand windows
  // instead of extending an FT shift through a demand valley.
  //   FT  = 2   WFT = 2
  //   PT  = 1   WPT = 1
  lines.push("Minimize");
  const objTerms: string[] = [];
  FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(`2 ${varFT(s, p, b)}`))));
  PT_STARTS .forEach((s) => MON_FRI.forEach((p) => objTerms.push(`1 ${varPT(s, p)}`)));
  WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => objTerms.push(`2 ${varWFT(s, b)}`)));
  PT_STARTS .forEach((s) => objTerms.push(`1 ${varWPT(s)}`));
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

  // ── PT cap ─────────────────────────────────────────────────────────────────
  // Constraint: (PT+WPT) ≤ α × total  →  (1−α)(PT+WPT) − α(FT+WFT) ≤ 0
  // Multiply through by 100 to use plain integers and avoid LP-parser issues
  // with decimal coefficient strings (which corrupt HiGHS WASM memory).
  //   capPt = round(partTimerCapPct)  →  pos coeff = 100-capPt, neg coeff = capPt
  const capPt = Math.round(config.partTimerCapPct);
  if (capPt < 100) {
    const ptVars = allPTVars();
    if (capPt === 0) {
      ptVars.forEach((v) => { conCount++; lines.push(` c${conCount}: ${v} <= 0`); });
    } else {
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
  }

  // ── Weekender cap ──────────────────────────────────────────────────────────
  const capWk = Math.round(config.weekenderCapPct);
  if (capWk < 100) {
    const wkVars = allWkVars();
    if (capWk === 0) {
      wkVars.forEach((v) => { conCount++; lines.push(` c${conCount}: ${v} <= 0`); });
    } else {
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
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("Bounds");
  FT_STARTS .forEach((s) => MON_FRI.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => lines.push(` 0 <= ${varFT(s, p, b)}`))));
  PT_STARTS .forEach((s) => MON_FRI.forEach((p) => lines.push(` 0 <= ${varPT(s, p)}`)));
  WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => lines.push(` 0 <= ${varWFT(s, b)}`)));
  PT_STARTS .forEach((s) => lines.push(` 0 <= ${varWPT(s)}`));

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
