"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SolverResult } from "@/lib/types";

const COST_PER_HOUR = 783 / 8; // ₹97.875 per worker-hour

// Weekly paid hours by worker type (including break for FT/WFT)
const WEEKLY_PAID_HOURS = {
  FT:  9 * 6,   // 9h/day × 6 active days = 54h
  PT:  4 * 6,   // 4h/day × 6 active days = 24h
  WFT: 9 * 2,   // 9h/day × 2 weekend days = 18h
  WPT: 4 * 2,   // 4h/day × 2 weekend days = 8h
};

interface ResultsSummaryProps {
  result: SolverResult;
}

export function ResultsSummary({ result }: ResultsSummaryProps) {
  const { ftCount, ptCount, wftCount, wptCount, totalWorkers } = result;

  // FTE: FT/WFT = 1.0, PT/WPT = 0.5
  const fte = ftCount + wftCount + 0.5 * (ptCount + wptCount);

  // Estimated weekly labor cost (paid hours × rate)
  const weeklyPaidHours =
    ftCount  * WEEKLY_PAID_HOURS.FT  +
    ptCount  * WEEKLY_PAID_HOURS.PT  +
    wftCount * WEEKLY_PAID_HOURS.WFT +
    wptCount * WEEKLY_PAID_HOURS.WPT;
  const laborCost = weeklyPaidHours * COST_PER_HOUR;

  // PT mix
  const ptPct = totalWorkers > 0
    ? Math.round(((ptCount + wptCount) / totalWorkers) * 100)
    : 0;

  // Service level
  let totalSlots = 0;
  let coveredSlots = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (result.required[d][h] > 0) {
        totalSlots++;
        if (result.coverage[d][h] >= result.required[d][h]) coveredSlots++;
      }
    }
  }
  const coveragePct = totalSlots > 0 ? Math.round((coveredSlots / totalSlots) * 100) : 100;

  const mixData = [
    { name: "FT",  value: ftCount,  color: "#3b82f6" },
    { name: "PT",  value: ptCount,  color: "#10b981" },
    { name: "WFT", value: wftCount, color: "#8b5cf6" },
    { name: "WPT", value: wptCount, color: "#f97316" },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

      {/* 1 — Headcount */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-gray-500">Total Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-blue-600">{totalWorkers}</div>
          <div className="mt-1.5 space-y-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400">FTE equivalent</span>
              <span className="text-sm font-semibold text-gray-700">{fte.toFixed(1)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400">Solve time</span>
              <span className="text-xs text-gray-500">{result.solveTimeMs ?? "?"}ms</span>
            </div>
          </div>
          <div className="mt-2 border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-400 leading-tight">
              FT/WFT = 1.0 FTE · PT/WPT = 0.5 FTE
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2 — Worker mix with pie chart */}
      <Card className="md:col-span-2">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-gray-500">Worker Mix</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="w-24 h-24 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mixData}
                  cx="50%"
                  cy="50%"
                  innerRadius={22}
                  outerRadius={40}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {mixData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value: number | undefined, name: string | undefined) => [`${value ?? 0} workers`, name ?? ""]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 text-sm flex-1">
            <MixRow label="FT"  count={ftCount}  total={totalWorkers} color="bg-blue-500" />
            <MixRow label="PT"  count={ptCount}  total={totalWorkers} color="bg-green-500" />
            <MixRow label="WFT" count={wftCount} total={totalWorkers} color="bg-purple-500" />
            <MixRow label="WPT" count={wptCount} total={totalWorkers} color="bg-orange-500" />
          </div>
        </CardContent>
      </Card>

      {/* 3 — PT share */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-gray-500">Part-timers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">{ptPct}%</div>
          <p className="text-xs text-gray-400 mt-1">{ptCount + wptCount} of {totalWorkers} workers</p>
          <Progress value={ptPct} className="mt-2 h-2" />
        </CardContent>
      </Card>

      {/* 4 — Service level */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-gray-500">Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-3xl font-bold ${coveragePct === 100 ? "text-green-600" : "text-orange-600"}`}>
            {coveragePct}%
          </div>
          <p className="text-xs text-gray-400 mt-1">{coveredSlots} / {totalSlots} slots met</p>
          <Progress value={coveragePct} className="mt-2 h-2" />
        </CardContent>
      </Card>

      {/* 5 — Labor cost */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-gray-500">Est. Weekly Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-gray-800">
            ₹{Math.round(laborCost).toLocaleString("en-IN")}
          </div>
          <div className="mt-1.5 space-y-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400">Paid hrs/week</span>
              <span className="text-xs text-gray-600 font-medium">{weeklyPaidHours.toLocaleString()}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-400">Rate</span>
              <span className="text-xs text-gray-600">₹{COST_PER_HOUR.toFixed(2)}/hr</span>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function MixRow({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} />
      <span className="w-8 text-xs font-medium">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{count}</span>
    </div>
  );
}
