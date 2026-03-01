// 7 rows (Mon–Sun) × 24 columns (hour 0–23)
export type OphMatrix = number[][];

export type WorkerType = "FT" | "PT" | "WFT" | "WPT";

export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Mon … 6=Sun

export interface OptimizerConfig {
  /** Orders per picker per hour (default 12) */
  productivityRate: number;
  /** Max PT workers as % of total (default 40) */
  partTimerCapPct: number;
  /** Max weekender workers as % of total (default 30) */
  weekenderCapPct: number;
  /** When true, FT/PT workers may have their day-off on Sat or Sun */
  allowWeekendDayOff: boolean;
}

export interface WorkerSlot {
  id: number;
  type: WorkerType;
  /** Shift start hour (0-23) */
  shiftStart: number;
  /** Shift end hour (exclusive) */
  shiftEnd: number;
  /** Day this slot has OFF (0=Mon…6=Sun), null for WFT/WPT (off Mon-Fri) */
  dayOff: DayIndex | null;
  /** Productive hours on each active day */
  productiveHours: number[];
  /** Break half-slot offsets within shift (FT/WFT only): two values in [4,13].
   *  Half-slot 0 = shiftStart:00-:30, 1 = shiftStart:30-next:00, etc.
   *  Each break is 30 min; total break = 1 h. */
  breakHalfSlots?: number[];
}

export interface SolverInput {
  oph: OphMatrix;
  config: OptimizerConfig;
}

export interface SolverResult {
  status: "optimal" | "infeasible" | "error";
  workers: WorkerSlot[];
  totalWorkers: number;
  ftCount: number;
  ptCount: number;
  wftCount: number;
  wptCount: number;
  /** Coverage matrix: [day][hour] = number of workers covering that slot */
  coverage: number[][];
  /** Required matrix: [day][hour] = ceil(oph/rate) */
  required: number[][];
  /** Raw demand matrix [day][hour] = orders per hour (echoed from input) */
  oph?: OphMatrix;
  solveTimeMs?: number;
  errorMessage?: string;
}

export type SolverMessageIn =
  | { type: "solve"; payload: SolverInput }

export type SolverMessageOut =
  | { type: "result"; payload: SolverResult }
  | { type: "progress"; message: string }
  | { type: "error"; message: string }
