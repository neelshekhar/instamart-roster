import * as XLSX from "xlsx";
import type { SolverResult, OptimizerConfig } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

/**
 * Export the solver result as a multi-sheet Excel workbook.
 * Returns a Blob that can be downloaded.
 */
export function exportToExcel(result: SolverResult, config: OptimizerConfig): Blob {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summaryData = [
    ["Instamart Roster Optimizer — Results"],
    [],
    ["Total Workers", result.totalWorkers],
    ["Full-time (FT)", result.ftCount],
    ["Part-time (PT)", result.ptCount],
    ["Weekend FT (WFT)", result.wftCount],
    ["Weekend PT (WPT)", result.wptCount],
    [],
    ["Configuration"],
    ["Productivity Rate (orders/picker/hr)", config.productivityRate],
    ["PT Cap %", config.partTimerCapPct],
    ["Weekender Cap %", config.weekenderCapPct],
    [],
    ["Solve Time (ms)", result.solveTimeMs ?? "N/A"],
    ["Status", result.status],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // ── Sheet 2: Roster ───────────────────────────────────────────────────────
  const rosterHeader = [
    "Worker #",
    "Type",
    "Shift Start",
    "Shift End",
    "Day Off",
    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  ];
  const rosterRows = result.workers.map((w) => {
    const dayOffLabel =
      w.dayOff !== null ? DAYS[w.dayOff] : w.type === "WFT" || w.type === "WPT" ? "Mon–Fri" : "–";
    const activeDays = DAYS.map((_, d) => {
      if (w.type === "WFT" || w.type === "WPT") return d >= 5 ? "✓" : "–";
      return d !== w.dayOff ? "✓" : "OFF";
    });
    return [
      w.id,
      w.type,
      `${String(w.shiftStart).padStart(2, "0")}:00`,
      `${String(w.shiftEnd).padStart(2, "0")}:00`,
      dayOffLabel,
      ...activeDays,
    ];
  });
  const rosterSheet = XLSX.utils.aoa_to_sheet([rosterHeader, ...rosterRows]);
  XLSX.utils.book_append_sheet(wb, rosterSheet, "Roster");

  // ── Sheet 3: Coverage vs Required ────────────────────────────────────────
  for (let d = 0; d < 7; d++) {
    const header = [`${DAYS[d]} — Hour`, "Required", "Covered", "Gap"];
    const rows = HOURS.map((h, hi) => [
      h,
      result.required[d][hi],
      result.coverage[d][hi],
      result.coverage[d][hi] - result.required[d][hi],
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, sheet, `Coverage_${DAYS[d]}`);
  }

  const wbOut = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([wbOut], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
