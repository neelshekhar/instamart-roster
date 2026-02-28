"use client";

import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import type { SolverResult } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CoverageChartProps {
  result: SolverResult;
}

export function CoverageChart({ result }: CoverageChartProps) {
  const [selectedDay, setSelectedDay] = useState(0);

  const chartData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    Required: result.required[selectedDay][h],
    Deployed: result.coverage[selectedDay][h],
  }));

  const maxVal = Math.max(
    ...result.coverage[selectedDay],
    ...result.required[selectedDay]
  );

  const totalRequired = result.required[selectedDay].reduce((a, b) => a + b, 0);
  const totalDeployed = result.coverage[selectedDay].reduce((a, b) => a + b, 0);
  const netSurplus = totalDeployed - totalRequired;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Coverage vs Required — {DAYS[selectedDay]}</CardTitle>
          <div className="flex gap-1 flex-wrap">
            {DAYS.map((day, d) => {
              const hasDemand = result.required[d].some((v) => v > 0);
              const fullyMet = result.required[d].every(
                (v, h) => v === 0 || result.coverage[d][h] >= v
              );
              return (
                <Button
                  key={day}
                  variant={selectedDay === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDay(d)}
                  className="text-xs px-2 py-1 h-7"
                  disabled={!hasDemand}
                >
                  {day}
                  {hasDemand && (
                    <span className={`ml-1 w-1.5 h-1.5 rounded-full inline-block ${fullyMet ? "bg-green-400" : "bg-red-400"}`} />
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10 }}
              interval={1}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, Math.max(1, maxVal + 1)]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number | undefined, name: string | undefined) => [value ?? 0, name ?? ""]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {/* Required as a filled area (blue) — shows the demand envelope */}
            <Area
              type="monotone"
              dataKey="Required"
              fill="#93c5fd"
              stroke="#3b82f6"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            {/* Deployed as bars (green) — actual headcount scheduled */}
            <Bar dataKey="Deployed" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Daily stats */}
        <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
          <div className="bg-blue-50 rounded p-2">
            <div className="font-bold text-blue-700">{totalRequired}</div>
            <div className="text-xs text-gray-500">Required worker-hrs</div>
          </div>
          <div className="bg-green-50 rounded p-2">
            <div className="font-bold text-green-700">{totalDeployed}</div>
            <div className="text-xs text-gray-500">Deployed worker-hrs</div>
          </div>
          <div className={`rounded p-2 ${netSurplus < 0 ? "bg-red-50" : "bg-gray-50"}`}>
            <div className={`font-bold ${netSurplus < 0 ? "text-red-700" : "text-gray-700"}`}>
              {netSurplus >= 0 ? "+" : ""}{netSurplus}
            </div>
            <div className="text-xs text-gray-500">Net surplus</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
