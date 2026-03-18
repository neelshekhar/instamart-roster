"use client";

import { useState, useMemo } from "react";
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
  const [selectedDay, setSelectedDay] = useState(0);

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

        {/* ── OPH Processing Capacity vs Demand ── */}
        <OphCapacityPanel
          result={result}
          config={config}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />

      </CardContent>
    </Card>
  );
}

// ─── OPH Capacity Panel ───────────────────────────────────────────────────────

function OphCapacityPanel({
  result,
  config,
  selectedDay,
  onSelectDay,
}: {
  result: SolverResult;
  config: OptimizerConfig;
  selectedDay: number;
  onSelectDay: (d: number) => void;
}) {
  const rate = config.productivityRate;

  // Per-hour data for selected day
  const hourData = useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => {
      // OPH demand: use result.oph if available, else back-compute from required
      const ophDemand = result.oph
        ? result.oph[selectedDay][h]
        : result.required[selectedDay][h] * rate;
      const deployed   = result.coverage[selectedDay][h];
      const capacity   = deployed * rate;
      const unmet      = Math.max(0, ophDemand - capacity);
      const isPeak     = result.peakSlots?.[selectedDay]?.[h] ?? false;
      const isBreak    = ophDemand > 0 && unmet > 0;
      return { h, ophDemand, capacity, deployed, unmet, isPeak, isBreak };
    });
  }, [result, config, selectedDay, rate]);

  // Day-level aggregates
  const dayOPD      = hourData.reduce((s, r) => s + r.ophDemand, 0);
  const dayCapacity = hourData.reduce((s, r) => s + r.capacity, 0);
  const dayUnmet    = hourData.reduce((s, r) => s + r.unmet, 0);
  const breakCount  = hourData.filter(r => r.isBreak).length;

  // Scale bars to max value across demand and capacity for the day
  const maxVal = Math.max(...hourData.map(r => Math.max(r.ophDemand, r.capacity)), 1);

  // Only show hours with any demand OR deployed workers
  const hasData = hourData.some(r => r.ophDemand > 0 || r.deployed > 0);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-xs font-medium text-gray-500">OPH Processing Capacity vs Demand</p>
        <span className="text-xs text-gray-400">— which slots can break?</span>
      </div>

      {/* Day tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {DAYS.map((day, d) => {
          const dayReq = result.required[d].reduce((a, b) => a + b, 0);
          if (dayReq === 0) return null;
          return (
            <button
              key={day}
              onClick={() => onSelectDay(d)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedDay === d
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {!hasData ? (
        <p className="text-xs text-gray-400 italic">No demand data for this day.</p>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <MiniKpi label="OPD (Orders / Day)" value={Math.round(dayOPD).toLocaleString()} color="blue" />
            <MiniKpi label="Total Capacity (orders)" value={Math.round(dayCapacity).toLocaleString()} color={dayCapacity >= dayOPD ? "green" : "red"} />
            <MiniKpi label="Unfulfilled Orders" value={Math.round(dayUnmet).toLocaleString()} color={dayUnmet > 0 ? "red" : "green"} />
            <MiniKpi label="Break Slots" value={`${breakCount} hr${breakCount !== 1 ? "s" : ""}`} color={breakCount > 0 ? "red" : "green"} />
          </div>

          {/* Bar chart */}
          <div className="overflow-x-auto pb-1">
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", minWidth: 600 }}>
              {hourData.map(({ h, ophDemand, capacity, unmet, isPeak, isBreak }) => {
                const hasAnything = ophDemand > 0 || result.coverage[selectedDay][h] > 0;
                if (!hasAnything) {
                  return (
                    <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ height: 80 }} />
                      <div style={{ fontSize: 8, color: "#d1d5db", marginTop: 2 }}>{String(h).padStart(2, "0")}</div>
                    </div>
                  );
                }

                const demandH = Math.round((ophDemand / maxVal) * 80);
                const capH    = Math.round((capacity   / maxVal) * 80);
                const capColor = isBreak ? "#F87171" : "#4ADE80"; // red-400 / green-400

                const tooltip = `${DAYS[selectedDay]} ${String(h).padStart(2, "0")}:00\n` +
                  `Demand: ${Math.round(ophDemand)} orders/hr\n` +
                  `Capacity: ${Math.round(capacity)} orders/hr (${result.coverage[selectedDay][h]} workers × ${rate})\n` +
                  (isBreak ? `⚠️ Unmet: ${Math.round(unmet)} orders` : "✅ Covered");

                return (
                  <div
                    key={h}
                    title={tooltip}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      cursor: "default",
                    }}
                  >
                    {/* Break indicator */}
                    <div style={{ height: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isBreak && (
                        <span style={{ fontSize: 8, color: "#EF4444", fontWeight: 700 }}>!</span>
                      )}
                    </div>

                    {/* Dual bars */}
                    <div style={{ display: "flex", gap: 1, alignItems: "flex-end", height: 80 }}>
                      {/* Demand bar (blue) */}
                      <div
                        style={{
                          width: 7,
                          height: demandH,
                          backgroundColor: "#93C5FD", // blue-300
                          borderRadius: "2px 2px 0 0",
                          border: isPeak ? "1px solid #1D4ED8" : "none",
                          boxSizing: "border-box",
                        }}
                      />
                      {/* Capacity bar (green/red) */}
                      <div
                        style={{
                          width: 7,
                          height: capH,
                          backgroundColor: capColor,
                          borderRadius: "2px 2px 0 0",
                          opacity: 0.85,
                        }}
                      />
                    </div>

                    {/* Hour label */}
                    <div style={{ fontSize: 8, color: isPeak ? "#1D4ED8" : "#9CA3AF", marginTop: 2, fontWeight: isPeak ? 700 : 400 }}>
                      {String(h).padStart(2, "0")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart legend */}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div style={{ width: 10, height: 10, backgroundColor: "#93C5FD", borderRadius: 2 }} />
              <span>OPH Demand (orders/hr)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 10, height: 10, backgroundColor: "#4ADE80", borderRadius: 2 }} />
              <span>Processing Capacity (workers × rate)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 10, height: 10, backgroundColor: "#F87171", borderRadius: 2 }} />
              <span>Capacity shortfall — slot breaks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div style={{ width: 8, height: 10, border: "1px solid #1D4ED8", backgroundColor: "#93C5FD", borderRadius: 2 }} />
              <span>Peak demand hour</span>
            </div>
            <span className="text-gray-400 italic">Hover bars for exact figures</span>
          </div>

          {/* Break slots detail — only if any */}
          {breakCount > 0 && (
            <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-700 mb-1.5">⚠️ Break Slots — orders cannot be fully processed</p>
              <div className="flex flex-wrap gap-2">
                {hourData.filter(r => r.isBreak).map(r => (
                  <div key={r.h} className="text-xs bg-white border border-red-200 rounded px-2 py-0.5 text-red-800">
                    <span className="font-medium">{String(r.h).padStart(2, "0")}:00</span>
                    <span className="text-red-500 ml-1">–{Math.round(r.unmet)} orders unmet</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: string; color: "blue" | "green" | "red" }) {
  const colorMap = {
    blue:  { bg: "#EFF6FF", val: "#1D4ED8" },
    green: { bg: "#F0FDF4", val: "#166534" },
    red:   { bg: "#FEF2F2", val: "#991B1B" },
  };
  const c = colorMap[color];
  return (
    <div style={{ backgroundColor: c.bg, borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: c.val, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{label}</div>
    </div>
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
