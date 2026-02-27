"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportToExcel, downloadBlob } from "@/lib/exporter";
import type { SolverResult, OptimizerConfig, WorkerType } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAGE_SIZE = 50;

const TYPE_COLORS: Record<WorkerType, string> = {
  FT: "bg-blue-100 text-blue-800",
  PT: "bg-green-100 text-green-800",
  WFT: "bg-purple-100 text-purple-800",
  WPT: "bg-orange-100 text-orange-800",
};

interface RosterTableProps {
  result: SolverResult;
  config: OptimizerConfig;
}

type SortKey = "id" | "type" | "shiftStart" | "dayOff";

export function RosterTable({ result, config }: RosterTableProps) {
  const [filterType, setFilterType] = useState<WorkerType | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let rows = filterType === "ALL"
      ? result.workers
      : result.workers.filter((w) => w.type === filterType);

    rows = [...rows].sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      switch (sortKey) {
        case "type":    va = a.type; vb = b.type; break;
        case "shiftStart": va = a.shiftStart; vb = b.shiftStart; break;
        case "dayOff": va = a.dayOff ?? 99; vb = b.dayOff ?? 99; break;
        default:        va = a.id; vb = b.id;
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return rows;
  }, [result.workers, filterType, sortKey, sortAsc]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(true); }
    setPage(0);
  };

  const handleExport = () => {
    const blob = exportToExcel(result, config);
    downloadBlob(blob, `roster-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-gray-50"
      onClick={() => handleSort(k)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === k ? (sortAsc ? " ↑" : " ↓") : ""}
      </span>
    </TableHead>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">
            Worker Roster — {filtered.length} workers
          </CardTitle>
          <div className="flex gap-2 flex-wrap items-center">
            {(["ALL", "FT", "PT", "WFT", "WPT"] as const).map((t) => (
              <Button
                key={t}
                variant={filterType === t ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setFilterType(t); setPage(0); }}
              >
                {t}
                {t !== "ALL" && (
                  <span className="ml-1 text-xs opacity-70">
                    ({result.workers.filter((w) => w.type === t).length})
                  </span>
                )}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
              Export Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="#" k="id" />
                <SortHeader label="Type" k="type" />
                <SortHeader label="Start" k="shiftStart" />
                <TableHead>End</TableHead>
                <SortHeader label="Day Off" k="dayOff" />
                {DAYS.map((d) => <TableHead key={d} className="text-center px-1">{d}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((w) => {
                const isWeekender = w.type === "WFT" || w.type === "WPT";
                const dayOffLabel = w.dayOff !== null ? DAYS[w.dayOff] : (isWeekender ? "Mon–Fri" : "–");
                return (
                  <TableRow key={w.id} className="hover:bg-gray-50">
                    <TableCell className="font-medium text-sm">{w.id}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${TYPE_COLORS[w.type]}`} variant="outline">
                        {w.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {String(w.shiftStart).padStart(2, "0")}:00
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {String(w.shiftEnd).padStart(2, "0")}:00
                    </TableCell>
                    <TableCell className="text-sm">{dayOffLabel}</TableCell>
                    {DAYS.map((_, d) => {
                      const active = isWeekender
                        ? d >= 5
                        : d !== w.dayOff;
                      return (
                        <TableCell key={d} className="text-center px-1">
                          {active ? (
                            <span className="text-green-600 text-sm">✓</span>
                          ) : (
                            <span className="text-gray-300 text-sm">–</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
