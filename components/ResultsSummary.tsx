"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { SolverResult } from "@/lib/types";

interface ResultsSummaryProps {
  result: SolverResult;
}

export function ResultsSummary({ result }: ResultsSummaryProps) {
  const ptPct = result.totalWorkers > 0
    ? Math.round(((result.ptCount + result.wptCount) / result.totalWorkers) * 100)
    : 0;
  const wkPct = result.totalWorkers > 0
    ? Math.round(((result.wftCount + result.wptCount) / result.totalWorkers) * 100)
    : 0;

  // Coverage quality
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <SummaryCard
        title="Total Workers"
        value={result.totalWorkers}
        subtitle={`Solve time: ${result.solveTimeMs ?? "?"}ms`}
        accent="blue"
      />
      <SummaryCard
        title="Worker Mix"
        value={null}
        subtitle=""
        accent="gray"
      >
        <div className="mt-2 space-y-1.5 text-sm">
          <MixRow label="FT" count={result.ftCount} total={result.totalWorkers} color="bg-blue-500" />
          <MixRow label="PT" count={result.ptCount} total={result.totalWorkers} color="bg-green-500" />
          <MixRow label="WFT" count={result.wftCount} total={result.totalWorkers} color="bg-purple-500" />
          <MixRow label="WPT" count={result.wptCount} total={result.totalWorkers} color="bg-orange-500" />
        </div>
      </SummaryCard>
      <SummaryCard
        title="PT Workers"
        value={`${ptPct}%`}
        subtitle={`${result.ptCount + result.wptCount} of ${result.totalWorkers}`}
        accent="green"
      >
        <Progress value={ptPct} className="mt-2 h-2" />
      </SummaryCard>
      <SummaryCard
        title="Coverage"
        value={`${coveragePct}%`}
        subtitle={`${coveredSlots} / ${totalSlots} slots met`}
        accent={coveragePct === 100 ? "green" : "orange"}
      >
        <Progress value={coveragePct} className="mt-2 h-2" />
      </SummaryCard>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: number | string | null;
  subtitle: string;
  accent: "blue" | "green" | "orange" | "gray";
  children?: React.ReactNode;
}

const accentClasses = {
  blue: "text-blue-600",
  green: "text-green-600",
  orange: "text-orange-600",
  gray: "text-gray-700",
};

function SummaryCard({ title, value, subtitle, accent, children }: SummaryCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {value !== null && (
          <div className={`text-3xl font-bold ${accentClasses[accent]}`}>{value}</div>
        )}
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function MixRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
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
