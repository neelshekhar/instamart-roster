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
import type { SolverResult, OptimizerConfig, WorkerType, WorkerSlot } from "@/lib/types";

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
                      {w.shiftEnd > 23
                        ? <>{String(w.shiftEnd % 24).padStart(2, "0")}:00 <span className="text-xs text-gray-400">+1d</span></>
                        : `${String(w.shiftEnd).padStart(2, "0")}:00`
                      }
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

        <ShiftGantt workers={pageRows} />
      </CardContent>
    </Card>
  );
}

// ── Shift Gantt ───────────────────────────────────────────────────────────────

/**
 * For FT/WFT workers, find the raw break hour within [shiftStart, shiftEnd).
 * productiveHours is stored mod-24, so we compare rawHour % 24.
 */
function findBreakHour(w: WorkerSlot): number | null {
  if (w.type !== "FT" && w.type !== "WFT") return null;
  const prodSet = new Set(w.productiveHours);
  for (let raw = w.shiftStart; raw < w.shiftEnd; raw++) {
    if (!prodSet.has(raw % 24)) return raw;
  }
  return null;
}

const SLOT_W = 13; // px — width of each 30-min block
const SLOT_H = 20; // px — height of each block
const LABEL_W = 152; // px — fixed left-label column width

function fmtH(raw: number) {
  return String(raw % 24).padStart(2, "0");
}

function ShiftGantt({ workers }: { workers: WorkerSlot[] }) {
  if (workers.length === 0) return null;

  const rangeStart = Math.min(...workers.map((w) => w.shiftStart));
  const rangeEnd   = Math.max(...workers.map((w) => w.shiftEnd));
  const totalHours = rangeEnd - rangeStart;

  // One label tick per hour; show text every 2 hours so they don't crowd
  const axisTicks = Array.from({ length: totalHours + 1 }, (_, i) => rangeStart + i);

  return (
    <div className="mt-8 pt-6 border-t border-gray-100">

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">
          Shift Timeline&ensp;
          <span className="font-normal text-gray-400 text-xs">30-min blocks · current page</span>
        </h3>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-[3px] bg-emerald-400" />
            Working
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-[3px] bg-blue-400" />
            Break
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 rounded-[3px] bg-gray-100 border border-gray-200" />
            Off shift
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col">

          {/* Top time axis */}
          <div className="flex items-end mb-1" style={{ marginLeft: LABEL_W }}>
            {axisTicks.map((rawH, i) => (
              <div
                key={i}
                className="relative"
                style={{ width: i < totalHours ? SLOT_W * 2 + 1 : 0 }}
              >
                {i % 2 === 0 && (
                  <span className="absolute left-0 -translate-x-1/2 text-[9px] font-mono text-gray-400 select-none whitespace-nowrap">
                    {fmtH(rawH)}{rawH >= 24 ? "⁺" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Worker rows */}
          <div className="flex flex-col gap-[3px] mt-2">
            {workers.map((w) => {
              const breakHour = findBreakHour(w);
              const isWeekender = w.type === "WFT" || w.type === "WPT";

              return (
                <div key={w.id} className="flex items-center">

                  {/* Left label */}
                  <div
                    className="flex items-center gap-1.5 shrink-0 pr-2"
                    style={{ width: LABEL_W }}
                  >
                    <span className="text-[11px] text-gray-400 w-8 text-right tabular-nums">
                      #{w.id}
                    </span>
                    <Badge
                      className={`text-[9px] px-1 py-0 h-[18px] leading-none shrink-0 ${TYPE_COLORS[w.type]}`}
                      variant="outline"
                    >
                      {w.type}
                    </Badge>
                    <span className="text-[10px] text-gray-500 font-mono truncate">
                      {fmtH(w.shiftStart)}–{fmtH(w.shiftEnd)}
                      {w.shiftEnd > 24 && (
                        <span className="text-gray-400">⁺</span>
                      )}
                    </span>
                    {isWeekender && (
                      <span className="text-[9px] text-gray-400 shrink-0">Sat–Sun</span>
                    )}
                  </div>

                  {/* 30-min blocks grouped by hour */}
                  <div className="flex gap-[1px]">
                    {Array.from({ length: totalHours }, (_, hi) => {
                      const rawH = rangeStart + hi;
                      const inShift = rawH >= w.shiftStart && rawH < w.shiftEnd;
                      const isBreak = breakHour !== null && rawH === breakHour;

                      let blockColor: string;
                      if (!inShift)     blockColor = "bg-gray-100";
                      else if (isBreak) blockColor = "bg-blue-400";
                      else              blockColor = "bg-emerald-400";

                      // Each hour = 2 half-hour blocks side by side, separated by 1px,
                      // then a slightly larger 2px gap to the next hour.
                      return (
                        <div key={hi} className="flex gap-px mr-[1px]">
                          {[0, 1].map((half) => (
                            <div
                              key={half}
                              className={`rounded-[2px] ${blockColor} transition-opacity hover:opacity-80`}
                              style={{ width: SLOT_W, height: SLOT_H }}
                              title={`${fmtH(rawH)}:${half === 0 ? "00" : "30"}${rawH >= 24 ? " (+1d)" : ""} — ${isBreak ? "Break" : inShift ? "Working" : "Off shift"}`}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom time axis */}
          <div className="flex items-start mt-1" style={{ marginLeft: LABEL_W }}>
            {axisTicks.map((rawH, i) => (
              <div
                key={i}
                className="relative"
                style={{ width: i < totalHours ? SLOT_W * 2 + 1 : 0 }}
              >
                {i % 2 === 0 && (
                  <span className="absolute left-0 -translate-x-1/2 text-[9px] font-mono text-gray-400 select-none whitespace-nowrap">
                    {fmtH(rawH)}{rawH >= 24 ? "⁺" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
