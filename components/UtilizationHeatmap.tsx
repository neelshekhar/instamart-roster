"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SolverResult } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

type ViewMode = "efficiency" | "surplus" | "actual";

interface UtilizationHeatmapProps {
  result: SolverResult;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

/**
 * Labor efficiency coloring: required/coverage × 100
 * 100% = all deployed workers are needed (green)
 * <100% = some workers idle (yellow → orange as waste grows)
 * >100% = understaffed — should not happen in optimal solution (red)
 */
function efficiencyColor(eff: number | null): { bg: string; text: string } {
  if (eff === null) return { bg: "#f9fafb", text: "#d1d5db" };   // gray-50 / gray-300
  if (eff > 100)   return { bg: "#dc2626", text: "#fff" };        // red-600  — understaffed
  if (eff >= 95)   return { bg: "#16a34a", text: "#fff" };        // green-600 — near-perfect
  if (eff >= 85)   return { bg: "#4ade80", text: "#14532d" };     // green-400
  if (eff >= 70)   return { bg: "#facc15", text: "#713f12" };     // yellow-400
  if (eff >= 50)   return { bg: "#fb923c", text: "#fff" };        // orange-400
  return           { bg: "#ef4444", text: "#fff" };               // red-500   — heavy waste
}

/**
 * Surplus coloring: coverage − required
 * 0  = exact (green)
 * +N = idle workers (yellow/orange by magnitude)
 * <0 = deficit (red)
 */
function surplusColor(surplus: number | null, required: number): { bg: string; text: string } {
  if (surplus === null) return { bg: "#f9fafb", text: "#d1d5db" };
  if (surplus < 0)      return { bg: "#dc2626", text: "#fff" };       // understaffed
  if (surplus === 0)    return { bg: "#16a34a", text: "#fff" };       // perfect
  const wasteRatio = required > 0 ? surplus / required : 1;
  if (wasteRatio < 0.15) return { bg: "#4ade80", text: "#14532d" };   // ≤15% surplus
  if (wasteRatio < 0.30) return { bg: "#facc15", text: "#713f12" };   // 15–30%
  if (wasteRatio < 0.50) return { bg: "#fb923c", text: "#fff" };      // 30–50%
  return                  { bg: "#ef4444", text: "#fff" };             // >50% surplus
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UtilizationHeatmap({ result }: UtilizationHeatmapProps) {
  const [view, setView] = useState<ViewMode>("efficiency");

  // Compute per-slot metrics
  let totalRequired = 0;
  let totalCovered = 0;
  let understaffedSlots = 0;
  let activeSlots = 0;

  type CellData = { req: number; cov: number; surplus: number; eff: number } | null;

  const cells: CellData[][] = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const req = result.required[d][h];
      const cov = result.coverage[d][h];
      if (req === 0) return null;
      activeSlots++;
      totalRequired += req;
      totalCovered += cov;
      const surplus = cov - req;
      if (surplus < 0) understaffedSlots++;
      const eff = cov > 0 ? Math.round((req / cov) * 100) : 0;
      return { req, cov, surplus, eff };
    })
  );

  // Key metrics
  const serviceLevelPct = activeSlots > 0
    ? Math.round(((activeSlots - understaffedSlots) / activeSlots) * 100)
    : 100;
  const laborEfficiencyPct = totalCovered > 0
    ? Math.round((totalRequired / totalCovered) * 100)
    : 0;
  const surplusHours = totalCovered - totalRequired;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Labor Utilization</CardTitle>
          {/* View toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setView("efficiency")}
              className={`px-3 py-1.5 transition-colors ${view === "efficiency" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Efficiency %
            </button>
            <button
              onClick={() => setView("surplus")}
              className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${view === "surplus" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Surplus workers
            </button>
            <button
              onClick={() => setView("actual")}
              className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${view === "actual" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Actual vs Required
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            value={`${serviceLevelPct}%`}
            label="Service level"
            sub="Slots with demand fully met"
            accent={serviceLevelPct === 100 ? "green" : "red"}
          />
          <KpiCard
            value={`${laborEfficiencyPct}%`}
            label="Labor efficiency"
            sub="Of deployed hours actually needed"
            accent={laborEfficiencyPct >= 85 ? "green" : laborEfficiencyPct >= 70 ? "yellow" : "orange"}
          />
          <KpiCard
            value={totalRequired.toLocaleString()}
            label="Required worker-hrs"
            sub="Demand-driven across the week"
            accent="blue"
          />
          <KpiCard
            value={`+${surplusHours.toLocaleString()}`}
            label="Surplus worker-hrs"
            sub="Deployed but not strictly needed"
            accent="gray"
          />
        </div>

        {/* ── What does this mean? ── */}
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-1">
          {view === "efficiency" ? (
            <>
              <p className="font-semibold">Reading the Efficiency % heatmap</p>
              <p>
                Each cell = <strong>required ÷ available × 100</strong> for that day-hour slot.{" "}
                <strong>100%</strong> means every deployed worker is needed — zero idle time.{" "}
                <strong>75%</strong> means 1 in 4 workers is idle in that slot.
                Green = efficient · Yellow/orange = idle surplus · Red = understaffed.
              </p>
            </>
          ) : view === "surplus" ? (
            <>
              <p className="font-semibold">Reading the Surplus workers heatmap</p>
              <p>
                Each cell = <strong>available − required</strong> workers in that slot.{" "}
                <strong>0</strong> = exactly right · <strong>+2</strong> = 2 workers idle that hour ·{" "}
                negative = understaffed (should not occur in an optimal roster).
                Green = tight · Yellow/orange = excess coverage · Red = gap.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Reading the Actual vs Required heatmap</p>
              <p>
                Each cell shows <strong>deployed / required</strong> workers for that slot.{" "}
                <strong>8/8</strong> = exact coverage · <strong>10/8</strong> = 2 excess workers ·{" "}
                <strong>7/8</strong> = 1 worker short. Color follows the same efficiency scale.
              </p>
            </>
          )}
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
                    const { bg, text } = cell === null
                      ? efficiencyColor(null)
                      : view === "efficiency"
                      ? efficiencyColor(cell.eff)
                      : view === "surplus"
                      ? surplusColor(cell.surplus, cell.req)
                      : efficiencyColor(cell.eff); // "actual" uses efficiency coloring

                    const displayVal = cell === null
                      ? ""
                      : view === "efficiency"
                      ? `${cell.eff}`
                      : view === "surplus"
                      ? (cell.surplus === 0 ? "0" : `${cell.surplus > 0 ? "+" : ""}${cell.surplus}`)
                      : `${cell.cov}/${cell.req}`; // "actual": deployed/required

                    const tooltip = cell === null
                      ? `${day} ${HOURS[h]}: No demand`
                      : view === "efficiency"
                      ? `${day} ${HOURS[h]}: ${cell.eff}% efficient — ${cell.req} needed, ${cell.cov} deployed (${cell.surplus >= 0 ? "+" : ""}${cell.surplus} surplus)`
                      : view === "surplus"
                      ? `${day} ${HOURS[h]}: ${cell.surplus >= 0 ? "+" : ""}${cell.surplus} surplus workers — ${cell.req} needed, ${cell.cov} deployed`
                      : `${day} ${HOURS[h]}: ${cell.cov} deployed / ${cell.req} required (${cell.eff}% efficient)`;

                    return (
                      <td key={h} className="p-0">
                        <div
                          title={tooltip}
                          style={{
                            backgroundColor: bg,
                            color: text,
                            height: 26,
                            width: 30,
                            fontSize: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "1px",
                            borderRadius: 3,
                            fontWeight: 600,
                            cursor: "default",
                            userSelect: "none",
                            letterSpacing: "-0.3px",
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
          {view === "efficiency" || view === "actual" ? (
            <>
              <LegendSwatch color="#16a34a" label="≥95% efficient" />
              <LegendSwatch color="#4ade80" label="85–94%" />
              <LegendSwatch color="#facc15" label="70–84%" />
              <LegendSwatch color="#fb923c" label="50–69%" />
              <LegendSwatch color="#ef4444" label="<50% / understaffed" />
              <LegendSwatch color="#f9fafb" label="No demand" border />
            </>
          ) : (
            <>
              <LegendSwatch color="#16a34a" label="0 surplus (exact)" />
              <LegendSwatch color="#4ade80" label="+1 to 15%" />
              <LegendSwatch color="#facc15" label="+15 to 30%" />
              <LegendSwatch color="#fb923c" label="+30 to 50%" />
              <LegendSwatch color="#ef4444" label=">50% / deficit" />
              <LegendSwatch color="#f9fafb" label="No demand" border />
            </>
          )}
        </div>

        {/* ── Per-day summary table ── */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Per-day summary</p>
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 px-2 text-gray-500 font-medium">Day</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Required hrs</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Deployed hrs</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Surplus hrs</th>
                <th className="py-1.5 px-2 text-gray-500 font-medium">Labor efficiency</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => {
                const req = result.required[d].reduce((a, b) => a + b, 0);
                const dep = result.coverage[d].reduce((a, b) => a + b, 0);
                const surplus = dep - req;
                const eff = dep > 0 ? Math.round((req / dep) * 100) : 0;
                if (req === 0) return null;
                return (
                  <tr key={day} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2 font-medium">{day}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{req}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{dep}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${surplus < 0 ? "text-red-600" : surplus === 0 ? "text-green-600" : "text-gray-500"}`}>
                      {surplus >= 0 ? "+" : ""}{surplus}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, eff)}%`,
                              backgroundColor: eff >= 85 ? "#16a34a" : eff >= 70 ? "#eab308" : "#f97316",
                            }}
                          />
                        </div>
                        <span className="w-9 text-right tabular-nums text-gray-700 font-medium">{eff}%</span>
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
  orange: { bg: "bg-orange-50", val: "text-orange-700" },
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
