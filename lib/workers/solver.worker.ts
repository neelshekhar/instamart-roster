/// <reference lib="webworker" />
import type { SolverInput, SolverResult, WorkerSlot, DayIndex } from "../types";

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

const FT_BREAK_OFFSETS: number[] = [3, 4, 5]; // break 3, 4, or 5 hours after shift start (staggered; 2×30min = 1h hole)

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

// ─── Variable pre-filtering ────────────────────────────────────────────────────
//
// Only include a variable in the LP if it covers at least one (day, hour) cell
// with positive demand.  Variables with zero coverage potential are always 0 in
// any feasible solution, so omitting them is semantically equivalent but produces
// a smaller LP string — preventing HiGHS WASM LP-parser buffer overflows that
// manifest as "function signature mismatch" / "memory access out of bounds".

function isActiveFT(oph: number[][], s: number, p: number, b: number): boolean {
  const sameDayHrs = ftHours(s, b);
  const nextDayHrs = ftHoursRaw(s, b).filter((h) => h >= 24).map((h) => h - 24);
  for (const d of ALL_DAYS) {
    if (d === p) continue; // day off
    if (sameDayHrs.some((h) => oph[d][h] > 0)) return true;
    if (nextDayHrs.length > 0) {
      const nd = (d + 1) % 7;
      if (nextDayHrs.some((h) => oph[nd][h] > 0)) return true;
    }
  }
  return false;
}

function isActivePT(oph: number[][], s: number, p: number): boolean {
  const hrs = ptHours(s);
  return ALL_DAYS.filter((d) => d !== p).some((d) => hrs.some((h) => oph[d][h] > 0));
}

function isActiveWFT(oph: number[][], s: number, b: number): boolean {
  return ftHours(s, b).some((h) => [5, 6].some((d) => oph[d][h] > 0));
}

function isActiveWPT(oph: number[][], s: number): boolean {
  return ptHours(s).some((h) => [5, 6].some((d) => oph[d][h] > 0));
}

// ─── LP builder ──────────────────────────────────────────────────────────────
//
// HiGHS WASM MIP solver: objective coefficients must all be 1 (non-uniform
// coefficients trigger Aborted() / memory faults in the WASM binary).
// Objective: minimise total headcount (all active vars get coefficient 1).
//
function buildLP(input: SolverInput): string {
  const { oph, config } = input;
  const rate = config.productivityRate;

  // ── Active variable types ──────────────────────────────────────────────────
  // When a cap is 0 its variable type is completely excluded from the LP —
  // no objective terms, no constraint terms, no bounds, no General entries.
  // This is the only reliable way to avoid HiGHS WASM LP-parser buffer
  // overflows (which fire when many zero-fix lines appear in any section).
  const capPt = Math.round(config.partTimerCapPct);
  const capWk = Math.round(config.weekenderCapPct);
  const usePT  = capPt > 0;                // include xPT vars
  const useWFT = capWk > 0;                // include xWFT vars
  const useWPT = capPt > 0 && capWk > 0;  // include xWPT vars (both caps must be > 0)
  const DAY_OFF_DAYS = config.allowWeekendDayOff ? ALL_DAYS : MON_FRI;

  // Pre-filter: only keep variables that cover ≥1 demand slot.
  // This keeps the LP string small enough for the HiGHS WASM LP parser.
  interface FTVar { s: number; p: number; b: number }
  interface PTVar { s: number; p: number }
  interface WFTVar { s: number; b: number }

  const ftVars: FTVar[] = [];
  FT_STARTS.forEach((s) => DAY_OFF_DAYS.forEach((p) => FT_BREAK_OFFSETS.forEach((b) => {
    if (isActiveFT(oph, s, p, b)) ftVars.push({ s, p, b });
  })));

  const ptVars: PTVar[] = [];
  if (usePT) PT_STARTS.forEach((s) => DAY_OFF_DAYS.forEach((p) => {
    if (isActivePT(oph, s, p)) ptVars.push({ s, p });
  }));

  const wftVars: WFTVar[] = [];
  if (useWFT) WFT_STARTS.forEach((s) => FT_BREAK_OFFSETS.forEach((b) => {
    if (isActiveWFT(oph, s, b)) wftVars.push({ s, b });
  }));

  const wptStarts: number[] = [];
  if (useWPT) PT_STARTS.forEach((s) => {
    if (isActiveWPT(oph, s)) wptStarts.push(s);
  });

  const lines: string[] = [];

  // ── Objective ──────────────────────────────────────────────────────────────
  lines.push("Minimize");
  const objTerms: string[] = [];
  ftVars .forEach(({ s, p, b }) => objTerms.push(varFT(s, p, b)));
  ptVars .forEach(({ s, p })    => objTerms.push(varPT(s, p)));
  wftVars.forEach(({ s, b })    => objTerms.push(varWFT(s, b)));
  wptStarts.forEach((s)         => objTerms.push(varWPT(s)));
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

      // FT same-day
      ftVars.forEach(({ s, p, b }) => {
        if (d !== p && ftHours(s, b).includes(h)) terms.push(varFT(s, p, b));
      });

      // FT overnight: shift started on prevDay, wraps into hour h on day d
      const prevDay = (d - 1 + 7) % 7;
      ftVars.forEach(({ s, p, b }) => {
        if (s < 20) return; // only overnight starts
        if (p === prevDay) return; // day off is the shift day
        if (ftHoursRaw(s, b).includes(h + 24)) terms.push(varFT(s, p, b));
      });

      // PT (no overnight)
      ptVars.forEach(({ s, p }) => {
        if (d !== p && ptHours(s).includes(h)) terms.push(varPT(s, p));
      });

      // Weekend workers (Sat=5, Sun=6 only)
      if (d === 5 || d === 6) {
        wftVars.forEach(({ s, b }) => {
          if (ftHours(s, b).includes(h)) terms.push(varWFT(s, b));
        });
        wptStarts.forEach((s) => {
          if (ptHours(s).includes(h)) terms.push(varWPT(s));
        });
      }

      if (terms.length === 0) continue;
      conCount++;
      lines.push(` c${conCount}: ${terms.join(" + ")} >= ${required}`);
    }
  }

  // ── Cap constraints (integer coefficients, ×100 scaled) ───────────────────
  // Only emitted when the relevant variable types are active (cap > 0)
  // and the cap is actually binding (cap < 100).
  if (usePT && capPt < 100) {
    // PT-cap: (100-capPt)(PT+WPT) - capPt(FT+WFT) ≤ 0
    const ptV = ptVars.map(({ s, p }) => varPT(s, p));
    wptStarts.forEach((s) => ptV.push(varWPT(s)));

    const ftV = ftVars.map(({ s, p, b }) => varFT(s, p, b));
    wftVars.forEach(({ s, b }) => ftV.push(varWFT(s, b)));

    const lhs = ptV.map((v) => `${100 - capPt} ${v}`).join(" + ")
      + " - " + ftV.map((v) => `${capPt} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  if ((useWFT || useWPT) && capWk < 100) {
    // Weekender-cap: (100-capWk)(WFT+WPT) - capWk(FT+PT) ≤ 0
    const wkV = wftVars.map(({ s, b }) => varWFT(s, b));
    wptStarts.forEach((s) => wkV.push(varWPT(s)));

    const wdV = ftVars.map(({ s, p, b }) => varFT(s, p, b));
    ptVars.forEach(({ s, p }) => wdV.push(varPT(s, p)));

    const lhs = wkV.map((v) => `${100 - capWk} ${v}`).join(" + ")
      + " - " + wdV.map((v) => `${capWk} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  // ── Bounds (only active, demand-covering variables) ────────────────────────
  lines.push("");
  lines.push("Bounds");
  ftVars .forEach(({ s, p, b }) => lines.push(` 0 <= ${varFT(s, p, b)}`));
  ptVars .forEach(({ s, p })    => lines.push(` 0 <= ${varPT(s, p)}`));
  wftVars.forEach(({ s, b })    => lines.push(` 0 <= ${varWFT(s, b)}`));
  wptStarts.forEach((s)         => lines.push(` 0 <= ${varWPT(s)}`));

  // ── General / integer declarations ────────────────────────────────────────
  lines.push("");
  lines.push("General");
  const generals: string[] = [];
  ftVars .forEach(({ s, p, b }) => generals.push(varFT(s, p, b)));
  ptVars .forEach(({ s, p })    => generals.push(varPT(s, p)));
  wftVars.forEach(({ s, b })    => generals.push(varWFT(s, b)));
  wptStarts.forEach((s)         => generals.push(varWPT(s)));
  lines.push(" " + generals.join(" "));

  lines.push("");
  lines.push("End");
  return lines.join("\n");
}

// ─── Roster builder ──────────────────────────────────────────────────────────

function buildRoster(
  solution: Record<string, number>,
  oph: number[][],
  dayOffDays: number[]
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
    dayOffDays.forEach((p) => {
      FT_BREAK_OFFSETS.forEach((b) => {
        const count = Math.round(solution[varFT(s, p, b)] ?? 0);
        for (let i = 0; i < count; i++) {
          workers.push({
            id: id++, type: "FT",
            shiftStart: s, shiftEnd: s + 9,
            dayOff: p as DayIndex,
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
    dayOffDays.forEach((p) => {
      const count = Math.round(solution[varPT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({ id: id++, type: "PT", shiftStart: s, shiftEnd: s + 4, dayOff: p as DayIndex, productiveHours: ptHours(s) });
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

    self.postMessage({ type: "progress", message: "Solving — minimising total headcount…" });
    const t0 = Date.now();
    const lp = buildLP(input);
    const result = highs.solve(lp, {});

    if (result.Status !== "Optimal") {
      const res: SolverResult = {
        status: result.Status === "Infeasible" ? "infeasible" : "error",
        workers: [], totalWorkers: 0,
        ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
        coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        solveTimeMs: Date.now() - t0,
        errorMessage: `Solver status: ${result.Status}`,
      };
      self.postMessage({ type: "result", payload: res });
      return;
    }

    const solveTimeMs = Date.now() - t0;

    self.postMessage({ type: "progress", message: "Building roster from solution…" });

    const solution: Record<string, number> = {};
    for (const [name, col] of Object.entries(result.Columns as Record<string, { Primal: number }>)) {
      solution[name] = col.Primal;
    }

    const dayOffDays = input.config.allowWeekendDayOff ? ALL_DAYS : MON_FRI;
    const { workers, coverage, ftCount, ptCount, wftCount, wptCount } =
      buildRoster(solution, input.oph, dayOffDays);

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
