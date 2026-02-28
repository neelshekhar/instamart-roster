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

const MON_FRI: number[] = [0, 1, 2, 3, 4];
const ALL_DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * All 9 raw shift hours for a 9-hour worker starting at s.
 * Values ≥ 24 represent hours on the NEXT calendar day
 * (e.g. raw 25 = 1 AM next day for an overnight shift starting at 20:00).
 */
function raw9(s: number): number[] {
  return Array.from({ length: 9 }, (_, i) => s + i);
}

function ptHours(s: number): number[] {
  return [s, s + 1, s + 2, s + 3];
}

/**
 * Peak-protected smearing coefficient for a 9-hour shift worker.
 *
 * The 1-hour break is NOT taken during the 3 highest-demand hours in the
 * shift window.  Instead it is distributed equally across the remaining 6
 * hours, contributing 5/6 ≈ 0.8333 effective capacity per hour there.
 *
 * Returns 1.0 for the top-3 demand hours (worker fully productive).
 * Returns 5/6 for the other 6 hours (break smeared in).
 *
 * @param oph      demand matrix [7 days][24 hours]
 * @param s        shift start (raw hour 0–23)
 * @param shiftDay calendar day this shift STARTED (0–6)
 * @param rawH     raw hour being evaluated (s ≤ rawH ≤ s+8)
 */
function smearedCoeff(oph: number[][], s: number, shiftDay: number, rawH: number): number {
  const hours = raw9(s);
  const demands = hours.map((rh) => {
    const day = rh < 24 ? shiftDay : (shiftDay + 1) % 7;
    return oph[day][rh % 24];
  });
  const indexed = demands.map((d, i) => ({ i, d })).sort((a, b) => b.d - a.d);
  const top3 = new Set(indexed.slice(0, 3).map((x) => x.i));
  const rawIdx = hours.indexOf(rawH);
  return top3.has(rawIdx) ? 1.0 : 5 / 6;
}

// ─── Variable naming ──────────────────────────────────────────────────────────

function varFT(s: number, p: number): string  { return `xFT_${s}_${p}`; }
function varPT(s: number, p: number): string  { return `xPT_${s}_${p}`; }
function varWFT(s: number): string            { return `xWFT_${s}`; }
function varWPT(s: number): string            { return `xWPT_${s}`; }

// ─── Variable pre-filtering ────────────────────────────────────────────────────
//
// Only include a variable in the LP if it covers at least one (day, hour) cell
// with positive demand.  Variables with zero coverage potential are always 0 in
// any feasible solution, so omitting them is semantically equivalent but produces
// a smaller LP string — preventing HiGHS WASM LP-parser buffer overflows that
// manifest as "function signature mismatch" / "memory access out of bounds".

function isActiveFT(oph: number[][], s: number, p: number): boolean {
  const sameDayRaw = raw9(s).filter((rh) => rh < 24);
  const nextDayRaw = raw9(s).filter((rh) => rh >= 24).map((rh) => rh - 24);
  for (const d of ALL_DAYS) {
    if (d === p) continue;
    if (sameDayRaw.some((h) => oph[d][h] > 0)) return true;
    if (nextDayRaw.length > 0) {
      const nd = (d + 1) % 7;
      if (nextDayRaw.some((h) => oph[nd][h] > 0)) return true;
    }
  }
  return false;
}

function isActivePT(oph: number[][], s: number, p: number): boolean {
  const hrs = ptHours(s);
  return ALL_DAYS.filter((d) => d !== p).some((d) => hrs.some((h) => oph[d][h] > 0));
}

function isActiveWFT(oph: number[][], s: number): boolean {
  return raw9(s).some((rh) => rh < 24 && [5, 6].some((d) => oph[d][rh] > 0));
}

function isActiveWPT(oph: number[][], s: number): boolean {
  return ptHours(s).some((h) => [5, 6].some((d) => oph[d][h] > 0));
}

// ─── LP builder ──────────────────────────────────────────────────────────────
//
// HiGHS WASM MIP solver crashes whenever objective coefficients are non-uniform
// (any value other than 1) — both large integers (54/24) and small ones (2/1)
// trigger Aborted() / memory faults in the WASM binary.
//
// Workaround: two-phase approach, both phases use only coefficient = 1 in the
// objective. Fractional coefficients appear only in coverage constraints via the
// peak-protected smearing model (safe for HiGHS constraint rows).
//
//   Phase 1 → minimise total headcount (all-1 objective).
//   Phase 2 → add "total ≤ N_opt" and minimise FT + WFT only (PT/WPT vars
//             absent from objective).  Solver fills remaining budget with
//             part-timers to meet coverage, effectively maximising PT usage.
//
// phase    : 1 = headcount; 2 = min-FT given total cap
// totalCap : only used in phase 2; equals N_opt from phase 1
//
function buildLP(input: SolverInput, phase: 1 | 2 = 1, totalCap = 0): string {
  const { oph, config } = input;
  const rate = config.productivityRate;

  // ── Active variable types ──────────────────────────────────────────────────
  // When a cap is 0 its variable type is completely excluded from the LP —
  // no objective terms, no constraint terms, no bounds, no General entries.
  const capPt = Math.round(config.partTimerCapPct);
  const capWk = Math.round(config.weekenderCapPct);
  const usePT  = capPt > 0;
  const useWFT = capWk > 0;
  const useWPT = capPt > 0 && capWk > 0;
  const DAY_OFF_DAYS = config.allowWeekendDayOff ? ALL_DAYS : MON_FRI;

  // Pre-filter: only keep variables that cover ≥1 demand slot.
  interface FTVar  { s: number; p: number }
  interface PTVar  { s: number; p: number }
  interface WFTVar { s: number }

  const ftVars: FTVar[] = [];
  FT_STARTS.forEach((s) => DAY_OFF_DAYS.forEach((p) => {
    if (isActiveFT(oph, s, p)) ftVars.push({ s, p });
  }));

  const ptVars: PTVar[] = [];
  if (usePT) PT_STARTS.forEach((s) => DAY_OFF_DAYS.forEach((p) => {
    if (isActivePT(oph, s, p)) ptVars.push({ s, p });
  }));

  const wftVars: WFTVar[] = [];
  if (useWFT) WFT_STARTS.forEach((s) => {
    if (isActiveWFT(oph, s)) wftVars.push({ s });
  });

  const wptStarts: number[] = [];
  if (useWPT) PT_STARTS.forEach((s) => {
    if (isActiveWPT(oph, s)) wptStarts.push(s);
  });

  const lines: string[] = [];

  // ── Objective ──────────────────────────────────────────────────────────────
  lines.push("Minimize");
  const objTerms: string[] = [];
  if (phase === 1) {
    // Phase 1: minimise total headcount (all active vars get coefficient 1)
    ftVars .forEach(({ s, p }) => objTerms.push(varFT(s, p)));
    ptVars .forEach(({ s, p }) => objTerms.push(varPT(s, p)));
    wftVars.forEach(({ s })    => objTerms.push(varWFT(s)));
    wptStarts.forEach((s)      => objTerms.push(varWPT(s)));
  } else {
    // Phase 2: minimise FT + WFT only (PT/WPT are free → solver prefers them)
    ftVars .forEach(({ s, p }) => objTerms.push(varFT(s, p)));
    wftVars.forEach(({ s })    => objTerms.push(varWFT(s)));
  }
  lines.push(" obj: " + objTerms.join(" + "));

  lines.push("");
  lines.push("Subject To");

  let conCount = 0;

  // ── Coverage constraints (peak-protected smearing for 9h workers) ──────────
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const demand = oph[d][h];
      if (demand <= 0) continue;
      const required = Math.ceil(demand / rate);
      const terms: string[] = [];

      // FT same-day — top-3 demand hours in shift window → 1.0, rest → 5/6
      ftVars.forEach(({ s, p }) => {
        if (d === p) return;
        const sameDayRaw = raw9(s).filter((rh) => rh < 24);
        if (!sameDayRaw.includes(h)) return;
        const coeff = smearedCoeff(oph, s, d, h);
        terms.push(`${coeff.toFixed(8)} ${varFT(s, p)}`);
      });

      // FT overnight: shift started on prevDay, wraps into hour h on day d
      const prevDay = (d - 1 + 7) % 7;
      ftVars.forEach(({ s, p }) => {
        if (s < 20) return; // only overnight starts
        if (p === prevDay) return; // day off is the shift day
        if (!raw9(s).includes(h + 24)) return;
        const coeff = smearedCoeff(oph, s, prevDay, h + 24);
        terms.push(`${coeff.toFixed(8)} ${varFT(s, p)}`);
      });

      // PT — no break in a 4h shift, coefficient always 1
      ptVars.forEach(({ s, p }) => {
        if (d !== p && ptHours(s).includes(h)) terms.push(varPT(s, p));
      });

      // Weekend workers (Sat=5, Sun=6 only)
      if (d === 5 || d === 6) {
        // WFT with smearing (day-only: all raw hours < 24)
        wftVars.forEach(({ s }) => {
          if (!raw9(s).includes(h)) return; // WFT day-only, so h is already raw
          const coeff = smearedCoeff(oph, s, d, h);
          terms.push(`${coeff.toFixed(8)} ${varWFT(s)}`);
        });
        // WPT — no smearing
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

    const ftV = ftVars.map(({ s, p }) => varFT(s, p));
    wftVars.forEach(({ s }) => ftV.push(varWFT(s)));

    const lhs = ptV.map((v) => `${100 - capPt} ${v}`).join(" + ")
      + " - " + ftV.map((v) => `${capPt} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  if ((useWFT || useWPT) && capWk < 100) {
    // Weekender-cap: (100-capWk)(WFT+WPT) - capWk(FT+PT) ≤ 0
    const wkV = wftVars.map(({ s }) => varWFT(s));
    wptStarts.forEach((s) => wkV.push(varWPT(s)));

    const wdV = ftVars.map(({ s, p }) => varFT(s, p));
    ptVars.forEach(({ s, p }) => wdV.push(varPT(s, p)));

    const lhs = wkV.map((v) => `${100 - capWk} ${v}`).join(" + ")
      + " - " + wdV.map((v) => `${capWk} ${v}`).join(" - ");
    conCount++;
    lines.push(` c${conCount}: ${lhs} <= 0`);
  }

  // ── Phase 2 only: total active workers ≤ N_optimal from phase 1 ───────────
  if (phase === 2 && totalCap > 0) {
    const allV = ftVars.map(({ s, p }) => varFT(s, p));
    ptVars .forEach(({ s, p }) => allV.push(varPT(s, p)));
    wftVars.forEach(({ s })    => allV.push(varWFT(s)));
    wptStarts.forEach((s)      => allV.push(varWPT(s)));
    conCount++;
    lines.push(` c${conCount}: ${allV.join(" + ")} <= ${totalCap}`);
  }

  // ── Bounds (only active, demand-covering variables) ────────────────────────
  lines.push("");
  lines.push("Bounds");
  ftVars .forEach(({ s, p }) => lines.push(` 0 <= ${varFT(s, p)}`));
  ptVars .forEach(({ s, p }) => lines.push(` 0 <= ${varPT(s, p)}`));
  wftVars.forEach(({ s })    => lines.push(` 0 <= ${varWFT(s)}`));
  wptStarts.forEach((s)      => lines.push(` 0 <= ${varWPT(s)}`));

  // ── General / integer declarations ────────────────────────────────────────
  lines.push("");
  lines.push("General");
  const generals: string[] = [];
  ftVars .forEach(({ s, p }) => generals.push(varFT(s, p)));
  ptVars .forEach(({ s, p }) => generals.push(varPT(s, p)));
  wftVars.forEach(({ s })    => generals.push(varWFT(s)));
  wptStarts.forEach((s)      => generals.push(varWPT(s)));
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
  void oph; // oph not needed for roster building (smearing is LP-only)
  const workers: WorkerSlot[] = [];
  let id = 1;
  let ftCount = 0, ptCount = 0, wftCount = 0, wptCount = 0;

  FT_STARTS.forEach((s) => {
    dayOffDays.forEach((p) => {
      const count = Math.round(solution[varFT(s, p)] ?? 0);
      for (let i = 0; i < count; i++) {
        workers.push({
          id: id++, type: "FT",
          shiftStart: s, shiftEnd: s + 9,
          dayOff: p as DayIndex,
          // All 9 hours stored mod-24; overnight hours (raw ≥ 24) appear as
          // 0-7 and are attributed to the next calendar day by coverage logic.
          productiveHours: raw9(s).map((h) => h % 24),
        });
        ftCount++;
      }
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
    const count = Math.round(solution[varWFT(s)] ?? 0);
    for (let i = 0; i < count; i++) {
      workers.push({
        id: id++, type: "WFT",
        shiftStart: s, shiftEnd: s + 9,
        dayOff: null,
        productiveHours: raw9(s), // WFT day-only: all hours < 24
      });
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
    // Skip when capPt=0: no PT/WPT vars exist, Phase 2 gives the same answer
    // as Phase 1 and adding a redundant total-cap constraint can crash HiGHS.
    //
    // When Phase 2 does run we create a FRESH HiGHS instance.  Reusing the
    // Phase-1 instance causes "memory access out of bounds" because HiGHS WASM
    // does not fully reset its heap between successive solve() calls, so the
    // Phase-2 LP parser reads stale/corrupted memory left by Phase 1.
    const runPhase2 = Math.round(input.config.partTimerCapPct) > 0;
    let result = r1;

    if (runPhase2) {
      try {
        self.postMessage({ type: "progress", message: `Phase 2 — maximising part-timer usage (N=${nOpt})…` });
        const highs2 = await highsModule.default({ locateFile: (file: string) => `/${file}` });
        const lp2 = buildLP(input, 2, nOpt);
        const r2 = highs2.solve(lp2, {});
        if (r2.Status === "Optimal") result = r2;
      } catch {
        // Phase 2 failed — silently use Phase 1 solution (already optimal headcount)
      }
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
