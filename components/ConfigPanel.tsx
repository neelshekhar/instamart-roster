"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import type { OptimizerConfig, OphMatrix } from "@/lib/types";

interface ConfigPanelProps {
  oph: OphMatrix;
  onSolve: (config: OptimizerConfig) => void;
  solving: boolean;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function matrixStats(oph: OphMatrix) {
  let total = 0;
  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  let activeSlots = 0;
  const dailyTotals: number[] = Array(7).fill(0);
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = oph[d][h];
      total += v;
      dailyTotals[d] += v;
      if (v > peakVal) { peakVal = v; peakDay = d; peakHour = h; }
      if (v > 0) activeSlots++;
    }
  }
  const avgPerDay = Math.round(total / 7);
  return { total, peakDay, peakHour, peakVal, activeSlots, avgPerDay };
}

export function ConfigPanel({ oph, onSolve, solving }: ConfigPanelProps) {
  const [guarantee100, setGuarantee100] = useState(true);
  const [config, setConfig] = useState<OptimizerConfig>({
    productivityRate: 20,
    partTimerCapPct: 40,
    weekenderCapPct: 30,
    allowWeekendDayOff: false,
    nonPeakTolerancePct: 0,
  });

  // Raw string state so users can freely type without the field snapping
  const [raw, setRaw] = useState({
    productivityRate: "20",
    partTimerCapPct: "40",
    weekenderCapPct: "30",
  });

  // Effective config: when guarantee100 is on, force nonPeakTolerancePct to 0
  const effectiveConfig: OptimizerConfig = guarantee100
    ? { ...config, nonPeakTolerancePct: 0 }
    : config;

  const stats = matrixStats(oph);
  const peakRequired = Math.ceil(stats.peakVal / config.productivityRate);

  function handleChange(key: keyof OptimizerConfig, strVal: string, min: number, max: number) {
    setRaw((prev) => ({ ...prev, [key]: strVal }));
    const n = parseFloat(strVal);
    if (!isNaN(n) && n >= min && n <= max) {
      setConfig((prev) => ({ ...prev, [key]: n }));
    }
  }

  return (
    <div className="space-y-6">
      {/* Demand summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demand Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Total Orders" value={stats.total.toLocaleString()} />
            <StatCard label="Avg Orders / Day" value={stats.avgPerDay.toLocaleString()} />
            <StatCard label="Peak Demand" value={`${stats.peakVal} OPH`} />
            <StatCard label="Peak At" value={`${DAYS[stats.peakDay]} ${stats.peakHour}:00`} />
            <StatCard label="Active Slots" value={`${stats.activeSlots} / 168`} />
          </div>
        </CardContent>
      </Card>

      {/* 100% fulfillment guarantee banner */}
      <Card style={{ border: guarantee100 ? "1.5px solid #16a34a" : "1.5px solid #e5e7eb", background: guarantee100 ? "#f0fdf4" : "#fff" }}>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="guarantee100"
              checked={guarantee100}
              onChange={(e) => {
                setGuarantee100(e.target.checked);
                if (e.target.checked) setConfig((prev) => ({ ...prev, nonPeakTolerancePct: 0 }));
              }}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-green-600"
            />
            <div className="flex-1">
              <Label htmlFor="guarantee100" className="text-sm font-semibold cursor-pointer" style={{ color: guarantee100 ? "#15803d" : "#111827" }}>
                Guarantee 100% order fulfillment
              </Label>
              <p className="text-xs mt-0.5" style={{ color: guarantee100 ? "#166534" : "#6b7280" }}>
                {guarantee100
                  ? "Every hour with demand will be fully staffed. The solver will staff all slots to 100% — no unfulfilled orders. Non-peak tolerance is locked to 0%."
                  : "Off — the solver may understaff non-peak slots based on the tolerance setting below, which can leave orders unfulfilled during quiet hours."}
              </p>
            </div>
            {guarantee100 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 4, padding: "2px 8px", whiteSpace: "nowrap" }}>
                ✓ Active
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Config inputs */}
      <Card>
        <CardHeader>
          <CardTitle>Optimizer Configuration</CardTitle>
          <CardDescription>
            Set these parameters before running the ILP solver.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <NumberField
              label="Productivity Rate"
              description="Orders per picker per productive hour"
              value={raw.productivityRate}
              unit="OPH"
              hint={`Peak staffing: ${peakRequired} workers`}
              min={1}
              max={100}
              onChange={(v) => handleChange("productivityRate", v, 1, 100)}
            />
            <NumberField
              label="Part-timer Cap"
              description="Max PT + WPT as % of total workforce. Enter 0 to allow no part-timers at all."
              value={raw.partTimerCapPct}
              unit="%"
              hint={
                config.partTimerCapPct === 0
                  ? "No part-timers (PT/WPT) will be assigned"
                  : config.partTimerCapPct === 100
                  ? "Unconstrained — any mix of PT/FT allowed"
                  : `PT + WPT ≤ ${config.partTimerCapPct}% of total headcount`
              }
              min={0}
              max={100}
              onChange={(v) => handleChange("partTimerCapPct", v, 0, 100)}
            />
            <NumberField
              label="Weekender Cap"
              description="Max WFT + WPT as % of total workforce. Enter 0 to allow no weekenders at all."
              value={raw.weekenderCapPct}
              unit="%"
              hint={
                config.weekenderCapPct === 0
                  ? "No weekenders (WFT/WPT) will be assigned"
                  : config.weekenderCapPct === 100
                  ? "Unconstrained — any mix of weekenders/regulars allowed"
                  : `WFT + WPT ≤ ${config.weekenderCapPct}% of total headcount`
              }
              min={0}
              max={100}
              onChange={(v) => handleChange("weekenderCapPct", v, 0, 100)}
            />
            <div className="md:col-span-3 flex items-start gap-3 pt-2 border-t">
              <input
                type="checkbox"
                id="allowWeekendDayOff"
                checked={config.allowWeekendDayOff}
                onChange={(e) => setConfig((prev) => ({ ...prev, allowWeekendDayOff: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-blue-600"
              />
              <div>
                <Label htmlFor="allowWeekendDayOff" className="text-sm font-medium cursor-pointer">
                  Allow weekend day-offs for FT / PT workers
                </Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  When enabled, FT and PT workers may take their day-off on Saturday or Sunday.
                  Gives the solver flexibility to reduce weekend over-staffing.
                </p>
              </div>
            </div>

            {/* Non-peak tolerance slider */}
            <div className={`md:col-span-3 pt-2 border-t space-y-2 ${guarantee100 ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Non-peak tolerance</Label>
                <span className="text-sm font-semibold text-blue-600">
                  {guarantee100 ? "0%" : `${config.nonPeakTolerancePct}%`}
                  {guarantee100 && <span className="ml-1 text-xs text-gray-400">(locked — 100% fill on)</span>}
                </span>
              </div>
              <Slider
                min={0}
                max={20}
                step={1}
                value={[guarantee100 ? 0 : config.nonPeakTolerancePct]}
                onValueChange={([v]) => { if (!guarantee100) setConfig((prev) => ({ ...prev, nonPeakTolerancePct: v })); }}
                className="w-full"
                disabled={guarantee100}
              />
              <p className="text-xs text-gray-500">
                Off-peak slots (demand &lt;70% of day&apos;s peak) may be staffed this % below required.
                Peak slots always require full coverage.{" "}
                <span className="text-blue-600">Recommended: 0–10% for standard operations.</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shift rules reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift Rules Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <ShiftRule type="FT" label="Full-time" hours="9h slot, 8h productive" starts="05:00–15:00 or 20:00–23:00 (overnight)" off={config.allowWeekendDayOff ? "One day off (any day)" : "One weekday off (Mon–Fri)"} />
            <ShiftRule type="PT" label="Part-time" hours="4h straight, no break" starts="05:00 – 20:00" off={config.allowWeekendDayOff ? "One day off (any day)" : "One weekday off (Mon–Fri)"} />
            <ShiftRule type="WFT" label="Weekend FT" hours="9h slot, 8h productive" starts="05:00 – 20:00" off="Mon–Fri (always off)" />
            <ShiftRule type="WPT" label="Weekend PT" hours="4h straight, no break" starts="05:00 – 20:00" off="Mon–Fri (always off)" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => onSolve(effectiveConfig)} disabled={solving} className="min-w-[220px]">
          {solving ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Solving…
            </span>
          ) : (
            "Generate Optimal Roster"
          )}
        </Button>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  description: string;
  value: string;
  unit: string;
  hint?: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
}

function NumberField({ label, description, value, unit, hint, min, max, onChange }: NumberFieldProps) {
  const n = parseFloat(value);
  const invalid = isNaN(n) || n < min || n > max;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-gray-500 min-h-[2.5rem]">{description}</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full ${invalid ? "border-red-400 focus-visible:ring-red-400" : ""}`}
        />
        <Badge variant="outline" className="shrink-0 px-2 py-1 font-medium">
          {unit}
        </Badge>
      </div>
      {invalid && (
        <p className="text-xs text-red-500">Must be between {min} and {max}</p>
      )}
      {!invalid && hint && (
        <p className="text-xs text-blue-600">{hint}</p>
      )}
    </div>
  );
}

function ShiftRule({ type, label, hours, starts, off }: { type: string; label: string; hours: string; starts: string; off: string }) {
  const colors: Record<string, string> = {
    FT: "bg-blue-100 text-blue-800",
    PT: "bg-green-100 text-green-800",
    WFT: "bg-purple-100 text-purple-800",
    WPT: "bg-orange-100 text-orange-800",
  };
  return (
    <div className="border rounded-lg p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${colors[type]}`}>{type}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-xs text-gray-600 space-y-0.5">
        <div><span className="text-gray-400">Hours:</span> {hours}</div>
        <div><span className="text-gray-400">Starts:</span> {starts}</div>
        <div><span className="text-gray-400">Day off:</span> {off}</div>
      </div>
    </div>
  );
}
