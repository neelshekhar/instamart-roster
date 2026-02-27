"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = oph[d][h];
      total += v;
      if (v > peakVal) { peakVal = v; peakDay = d; peakHour = h; }
      if (v > 0) activeSlots++;
    }
  }
  return { total, peakDay, peakHour, peakVal, activeSlots };
}

export function ConfigPanel({ oph, onSolve, solving }: ConfigPanelProps) {
  const [config, setConfig] = useState<OptimizerConfig>({
    productivityRate: 12,
    partTimerCapPct: 40,
    weekenderCapPct: 30,
  });

  // Raw string state so users can freely type without the field snapping
  const [raw, setRaw] = useState({
    productivityRate: "12",
    partTimerCapPct: "40",
    weekenderCapPct: "30",
  });

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Orders" value={stats.total.toLocaleString()} />
            <StatCard label="Peak Demand" value={`${stats.peakVal} OPH`} />
            <StatCard label="Peak At" value={`${DAYS[stats.peakDay]} ${stats.peakHour}:00`} />
            <StatCard label="Active Slots" value={`${stats.activeSlots} / 168`} />
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
            <ShiftRule type="FT" label="Full-time" hours="9h slot, 8h productive" starts="05:00 – 15:00" off="One weekday off (Mon–Fri)" />
            <ShiftRule type="PT" label="Part-time" hours="4h straight, no break" starts="05:00 – 20:00" off="One weekday off (Mon–Fri)" />
            <ShiftRule type="WFT" label="Weekend FT" hours="9h slot, 8h productive" starts="05:00 – 15:00" off="Mon–Fri (always off)" />
            <ShiftRule type="WPT" label="Weekend PT" hours="4h straight, no break" starts="05:00 – 20:00" off="Mon–Fri (always off)" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => onSolve(config)} disabled={solving} className="min-w-[220px]">
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
      <p className="text-xs text-gray-500">{description}</p>
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
