"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SolverResult } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

interface UtilizationHeatmapProps {
  result: SolverResult;
}

/** Map a staffing ratio to a background color. */
function cellColor(ratio: number | null): string {
  if (ratio === null) return "bg-gray-50 text-gray-300";
  if (ratio === 0) return "bg-red-700 text-white";
  if (ratio < 0.6) return "bg-red-500 text-white";
  if (ratio < 0.8) return "bg-orange-400 text-white";
  if (ratio < 0.95) return "bg-yellow-300 text-gray-800";
  if (ratio < 1.05) return "bg-green-400 text-white";
  if (ratio < 1.3) return "bg-green-500 text-white";
  return "bg-green-700 text-white";
}

function formatPct(ratio: number | null): string {
  if (ratio === null) return "";
  return `${Math.round(ratio * 100)}`;
}

export function UtilizationHeatmap({ result }: UtilizationHeatmapProps) {
  // Compute per-slot staffing ratios and aggregate stats
  let totalRequired = 0;
  let totalCovered = 0;
  let underCount = 0;
  let perfectCount = 0;
  let overCount = 0;

  const ratios: (number | null)[][] = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const req = result.required[d][h];
      const cov = result.coverage[d][h];
      if (req === 0) return null;
      totalRequired += req;
      totalCovered += cov;
      const r = cov / req;
      if (r < 1) underCount++;
      else if (r < 1.05) perfectCount++;
      else overCount++;
      return r;
    })
  );

  const overallPct = totalRequired > 0 ? Math.round((totalCovered / totalRequired) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Staffing Utilization Heatmap</CardTitle>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <LegendItem color="bg-red-500" label="< 80%" />
            <LegendItem color="bg-yellow-300" label="80–95%" />
            <LegendItem color="bg-green-400" label="95–105%" />
            <LegendItem color="bg-green-600" label="> 105%" />
            <LegendItem color="bg-gray-50 border border-gray-200" label="No demand" textColor="text-gray-400" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary bar */}
        <div className="grid grid-cols-4 gap-3 mb-5 text-center text-sm">
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="font-bold text-blue-700 text-lg">{overallPct}%</div>
            <div className="text-xs text-gray-500">Overall avg</div>
          </div>
          <div className="bg-red-50 rounded-lg p-2">
            <div className="font-bold text-red-600 text-lg">{underCount}</div>
            <div className="text-xs text-gray-500">Under-staffed slots</div>
          </div>
          <div className="bg-green-50 rounded-lg p-2">
            <div className="font-bold text-green-600 text-lg">{perfectCount}</div>
            <div className="text-xs text-gray-500">On-target slots</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <div className="font-bold text-gray-600 text-lg">{overCount}</div>
            <div className="text-xs text-gray-500">Over-staffed slots</div>
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-xs">
            <thead>
              <tr>
                <th className="text-left px-2 py-1 font-medium text-gray-500 min-w-[36px]" />
                {HOURS.map((h) => (
                  <th
                    key={h}
                    className="text-center font-normal text-gray-400 px-0 py-1"
                    style={{ minWidth: 32, width: 32 }}
                  >
                    {h.slice(0, 2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => (
                <tr key={day}>
                  <td className="px-2 py-0.5 font-medium text-gray-600 text-xs whitespace-nowrap">
                    {day}
                  </td>
                  {ratios[d].map((ratio, h) => (
                    <td key={h} className="p-0">
                      <div
                        title={
                          ratio !== null
                            ? `${day} ${HOURS[h]}: ${Math.round(ratio * 100)}% staffed (${result.coverage[d][h]} / ${result.required[d][h]} workers)`
                            : `${day} ${HOURS[h]}: No demand`
                        }
                        className={`
                          flex items-center justify-center rounded-sm mx-px my-0.5
                          font-medium tabular-nums cursor-default select-none
                          ${cellColor(ratio)}
                        `}
                        style={{ height: 28, width: 30, fontSize: 9 }}
                      >
                        {ratio !== null ? formatPct(ratio) : ""}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Labor hours detail */}
        <div className="mt-5 overflow-x-auto">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Labor hours needed vs. available by day
          </p>
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 px-2 text-gray-500 font-medium">Day</th>
                <th className="text-right py-1 px-2 text-gray-500 font-medium">Needed</th>
                <th className="text-right py-1 px-2 text-gray-500 font-medium">Available</th>
                <th className="text-right py-1 px-2 text-gray-500 font-medium">Gap</th>
                <th className="py-1 px-2 text-gray-500 font-medium">Fill rate</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, d) => {
                const needed = result.required[d].reduce((a, b) => a + b, 0);
                const avail = result.coverage[d].reduce((a, b) => a + b, 0);
                const gap = avail - needed;
                const fill = needed > 0 ? avail / needed : 1;
                return (
                  <tr key={day} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 px-2 font-medium">{day}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{needed}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{avail}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${gap < 0 ? "text-red-600" : "text-green-600"}`}>
                      {gap >= 0 ? "+" : ""}{gap}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${fill >= 1 ? "bg-green-500" : fill >= 0.8 ? "bg-yellow-400" : "bg-red-500"}`}
                            style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }}
                          />
                        </div>
                        <span className="w-9 text-right tabular-nums text-gray-600">
                          {Math.round(fill * 100)}%
                        </span>
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

function LegendItem({
  color,
  label,
  textColor = "text-gray-700",
}: {
  color: string;
  label: string;
  textColor?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-4 h-4 rounded-sm ${color}`} />
      <span className={textColor}>{label}</span>
    </div>
  );
}
