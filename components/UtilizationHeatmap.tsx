"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SolverResult, OptimizerConfig } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

type ViewMode = "coverage" | "surplus" | "actual";

// ─── Color constants ──────────────────────────────────────────────────────────
// Soft tones consistent with the KPI card palette (red-50/green-50 family).

const COVERAGE_COLORS = {
  understaffed:     { bg: "#FECACA", text: "#991B1B" },  // red-200   / red-800
  balanced:         { bg: "#BBF7D0", text: "#166534" },  // green-200 / green-800
  overstaffed:      { bg: "#FEF08A", text: "#854D0E" },  // yellow-200 / yellow-800
  heavyOverstaffed: { bg: "#E9D5FF", text: "#6B21A8" },  // purple-200 / purple-800
  nodemand:         { bg: "#f9fafb", text: "#d1d5db" },
} as const;

// ─── Coverage helpers ─────────────────────────────────────────────────────────

function calcCoveragePct(deployed: number, required: number): number {
  return required > 0 ? Math.round((deployed / required) * 100) : 0;
}

function coverageColor(pct: number | null): { bg: string; text: string } {
  if (pct === null) return COVERAGE_COLORS.nodemand;
  if (pct < 85)     return COVERAGE_COLORS.understaffed;
  if (pct <= 105)   return COVERAGE_COLORS.balanced;
  if (pct <= 150)   return COVERAGE_COLORS.overstaffed;
  return                   COVERAGE_COLORS.heavyOverstaffed;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface UtilizationHeatmapProps {
  result: SolverResult;
  config: OptimizerConfig;
}

export function UtilizationHeatmap({ result, config }: UtilizationHeatmapProps) {
  const [view, setView] = useState<ViewMode>("coverage");

  let totalRequired = 0;
  let totalDeployed = 0;

  type CellData = { req: number; cov: number; pct: number; surplus: number } | null;

  const cells: CellData[][] = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const req = result.required[d][h];
      const cov = result.coverage[d][h];
      if (req === 0) return null;
      totalRequired += req;
      totalDeployed += cov;
      return { req, cov, pct: calcCoveragePct(cov, req), surplus: cov - req };
    })
  );

  const netDiff    = totalDeployed - totalRequired;
  const overallPct = calcCoveragePct(totalDeployed, totalRequired);

  return (
    <Card style={{ backgroundColor: "#FAFAFA" }}>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">Required vs Deployed Hours</CardTitle>
            <p className="text-xs text-gray-500 mt-0.5">Each cell shows Coverage % (Deployed ÷ Required)</p>
          </div>
          {/* View toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setView("coverage")}
              className={`px-3 py-1.5 transition-colors ${view === "coverage" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Coverage %
            </button>
            <button
              onClick={() => setView("surplus")}
              className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${view === "surplus" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Net Difference
            </button>
            <button
              onClick={() => setView("actual")}
              className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${view === "actual" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Deployed / Required
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            value={totalRequired.toLocaleString()}
            label="Total Required Hours"
            sub="Demand-driven across the week"
            accent="blue"
          />
          <KpiCard
            value={totalDeployed.toLocaleString()}
            label="Total Deployed Hours"
            sub="Assigned across the week"
            accent="gray"
          />
          <KpiCard
            value={`${netDiff >= 0 ? "+" : ""}${netDiff.toLocaleString()}`}
            label={netDiff >= 0 ? "Net Surplus Hours" : "Net Shortage Hours"}
            sub="Deployed minus required"
            accent={netDiff >= 0 ? "green" : "red"}
          />
          <KpiCard
            value={`${overallPct}%`}
            label="Overall Coverage %"
            sub="Total deployed ÷ required"
            accent={overallPct < 85 ? "red" : overallPct <= 150 ? "green" : "yellow"}
          />
        </div>

        {/* ── Heatmap grid ── */}
        <div className="overflow-x-auto">
          <table className="border-collapse w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                {HOURS.map((h) => (
                  <th
                    key={h}
                    className="text-center font-normal text-gray-400 pb-1"
                    style={{ fontSize: 9, width: 32 }}
                  >
                    {h.slice(0, 2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => (
                <tr key={day}>
                  <td
                    className="pr-2 font-medium text-gray-600 whitespace-nowrap text-right"
                    style={{ fontSize: 10 }}
                  >
                    {day}
                  </td>
                  {cells[d].map((cell, h) => {
                    const { bg, text } = coverageColor(cell === null ? null : cell.pct);

                    const displayVal = cell === null
                      ? ""
                      : view === "coverage"
                      ? `${cell.pct}`
                      : view === "surplus"
                      ? (cell.surplus === 0 ? "0" : `${cell.surplus > 0 ? "+" : ""}${cell.surplus}`)
                      : `${cell.cov}/${cell.req}`;

                    const isPeak = result.peakSlots?.[d]?.[h] ?? false;

                    const nonPeakNote =
                      cell && !isPeak && result.peakSlots && (config.nonPeakTolerancePct ?? 0) > 0
                        ? ` (non-peak: relaxed to ${Math.max(1, Math.ceil(cell.req * (1 - (config.nonPeakTolerancePct ?? 0) / 100)))} required)`
                        : "";

                    const tooltip = cell === null
                      ? `${day} ${HOURS[h]}: No demand`
                      : `${day} ${HOURS[h]}: ${cell.pct}% coverage — ${cell.req} Required Hours, ${cell.cov} Deployed Hours (${cell.surplus >= 0 ? "+" : ""}${cell.surplus})${nonPeakNote}`;

                    return (
                      <td key={h} className="p-0">
                        <div
                          title={tooltip}
                          style={{
                            backgroundColor: bg,
                            color: text,
                            height: 32,
                            width: 30,
                            fontSize: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                            margin: "1px",
                            borderRadius: 3,
                            fontWeight: 700,
                            cursor: "default",
                            userSelect: "none",
                            letterSpacing: "-0.3px",
                            border: isPeak && cell !== null ? "2px solid #000" : "2px solid transparent",
                            boxSizing: "border-box",
                          }}
                        >
                          {displayVal}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Legend ── */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500">
          <span className="font-medium text-gray-700">Coverage % (Deployed ÷ Required)</span>
          <LegendSwatch color={COVERAGE_COLORS.balanced.bg}         label="85–105% — Balanced" />
          <LegendSwatch color={COVERAGE_COLORS.understaffed.bg}     label="<85% — Understaffed" />
          <LegendSwatch color={COVERAGE_COLORS.overstaffed.bg}      label="105–150% — Overstaffed" />
          <LegendSwatch color={COVERAGE_COLORS.heavyOverstaffed.bg} label=">150% — Heavy Overstaffed" />
          {result.peakSlots && (
            <div className="flex items-center gap-1.5">
              <div style={{ width: 14, height: 14, borderRadius: 2, border: "2px solid #000" }} />
              <span>Peak demand hour</span>
            </div>
          )}
          <LegendSwatch color={COVERAGE_COLORS.nodemand.bg} label="No demand" border />
        </div>

        {/* ── Per-day summary table ── */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Per-day summary</p>
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 px-2 text-gray-500 font-medium">Day</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Required Hours</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Deployed Hours</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Net Difference</th>
                <th className="py-1.5 px-2 text-gray-500 font-medium">Coverage %</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => {
                const req  = result.required[d].reduce((a, b) => a + b, 0);
                const dep  = result.coverage[d].reduce((a, b) => a + b, 0);
                const diff = dep - req;
                const pct  = calcCoveragePct(dep, req);
                if (req === 0) return null;
                const { bg: barColor } = coverageColor(pct);
                return (
                  <tr key={day} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2 font-medium">{day}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{req}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{dep}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${diff < 0 ? "text-red-600" : diff === 0 ? "text-green-700" : "text-gray-500"}`}>
                      {diff >= 0 ? "+" : ""}{diff}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
                          />
                        </div>
                        <span className="w-9 text-right tabular-nums text-gray-700 font-medium">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </CardContent>
    </Card>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const accentMap = {
  green:  { bg: "bg-green-50",  val: "text-green-700" },
  red:    { bg: "bg-red-50",    val: "text-red-700" },
  yellow: { bg: "bg-yellow-50", val: "text-yellow-700" },
  blue:   { bg: "bg-blue-50",   val: "text-blue-700" },
  gray:   { bg: "bg-gray-50",   val: "text-gray-700" },
};

function KpiCard({
  value, label, sub, accent,
}: {
  value: string;
  label: string;
  sub: string;
  accent: keyof typeof accentMap;
}) {
  const c = accentMap[accent];
  return (
    <div className={`${c.bg} rounded-lg p-3`}>
      <div className={`text-2xl font-bold ${c.val}`}>{value}</div>
      <div className="text-xs font-medium text-gray-700 mt-0.5">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}

function LegendSwatch({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        style={{ backgroundColor: color, width: 14, height: 14, borderRadius: 2 }}
        className={border ? "border border-gray-200" : ""}
      />
      <span>{label}</span>
    </div>
  );
}
