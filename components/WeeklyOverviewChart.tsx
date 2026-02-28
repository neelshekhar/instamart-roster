"use client";

import {
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SolverResult } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface WeeklyOverviewChartProps {
  result: SolverResult;
}

export function WeeklyOverviewChart({ result }: WeeklyOverviewChartProps) {
  // Per-day totals.
  // Efficiency is measured only at demand hours: workers present during
  // zero-demand hours (e.g. early starts before the store opens) are an
  // unavoidable structural cost of shift-based scheduling and should not
  // penalise the efficiency metric.
  const dailyData = DAYS.map((day, d) => {
    let required = 0;
    let covered  = 0; // only at hours where demand > 0
    for (let h = 0; h < 24; h++) {
      required += result.required[d][h];
      if (result.required[d][h] > 0) covered += result.coverage[d][h];
    }
    const surplus = covered - required;
    const eff     = covered > 0 ? Math.round((required / covered) * 100) : 0;
    return { day, required, covered, surplus, eff };
  });

  const { totalWorkers } = result;

  // Weekly totals
  const totalRequired = dailyData.reduce((a, d) => a + d.required, 0);
  const totalCovered  = dailyData.reduce((a, d) => a + d.covered, 0);
  const overallEff    = totalCovered > 0 ? Math.round((totalRequired / totalCovered) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Workers"    value={String(totalWorkers)} accent="blue" />
        <KpiCard label="Required Worker-hrs" value={totalRequired.toLocaleString()} accent="gray" />
        <KpiCard label="Deployed at Demand hrs" value={totalCovered.toLocaleString()} accent="gray" />
        <KpiCard label="Labor Efficiency"    value={`${overallEff}%`} accent={overallEff >= 85 ? "green" : overallEff >= 70 ? "yellow" : "orange"} />
      </div>

      {/* Composed bar+area chart — per day required vs covered */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly Coverage: Required vs Deployed</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number | undefined, name: string | undefined) => [(value ?? 0).toLocaleString(), name ?? ""]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="required" name="Required" fill="#ef4444" opacity={0.7} radius={[3, 3, 0, 0]} />
              <Area
                type="monotone"
                dataKey="covered"
                name="Deployed"
                fill="#3b82f6"
                stroke="#2563eb"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-day efficiency table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Day Efficiency Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="text-sm w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500 text-xs font-medium">
                <th className="text-left py-2 px-3">Day</th>
                <th className="text-right py-2 px-3">Required hrs</th>
                <th className="text-right py-2 px-3">Deployed hrs</th>
                <th className="text-right py-2 px-3">Surplus</th>
                <th className="py-2 px-3">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {dailyData.map(({ day, required, covered, surplus, eff }) => {
                if (required === 0) return null;
                return (
                  <tr key={day} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800">{day}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{required}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{covered}</td>
                    <td
                      className={`py-2 px-3 text-right tabular-nums font-medium ${
                        surplus < 0 ? "text-red-600" : surplus === 0 ? "text-green-600" : "text-gray-500"
                      }`}
                    >
                      {surplus >= 0 ? "+" : ""}{surplus}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, eff)}%`,
                              backgroundColor:
                                eff >= 85 ? "#16a34a" : eff >= 70 ? "#eab308" : "#f97316",
                            }}
                          />
                        </div>
                        <span className="w-9 text-right tabular-nums text-gray-700 text-xs font-medium">
                          {eff}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

const accentColors: Record<string, { bg: string; val: string }> = {
  blue:   { bg: "bg-blue-50",   val: "text-blue-700" },
  green:  { bg: "bg-green-50",  val: "text-green-700" },
  yellow: { bg: "bg-yellow-50", val: "text-yellow-700" },
  orange: { bg: "bg-orange-50", val: "text-orange-700" },
  gray:   { bg: "bg-gray-50",   val: "text-gray-700" },
};

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const c = accentColors[accent] ?? accentColors.gray;
  return (
    <div className={`${c.bg} rounded-lg p-3`}>
      <div className={`text-2xl font-bold ${c.val}`}>{value}</div>
      <div className="text-xs font-medium text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}
