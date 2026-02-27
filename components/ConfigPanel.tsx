"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import type { OptimizerConfig, OphMatrix } from "@/lib/types";

interface ConfigPanelProps {
  oph: OphMatrix;
  onSolve: (config: OptimizerConfig) => void;
  solving: boolean;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function matrixStats(oph: OphMatrix) {
  let total = 0;
  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  let activeSlots = 0;
  for (let d = 0; d < 7; d++) {
    let daySum = 0;
    for (let h = 0; h < 24; h++) {
      const v = oph[d][h];
      total += v;
      daySum += v;
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

  const stats = matrixStats(oph);
  const peakRequired = Math.ceil(stats.peakVal / config.productivityRate);

  const update = (key: keyof OptimizerConfig, value: number) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

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

      {/* Config sliders */}
      <Card>
        <CardHeader>
          <CardTitle>Optimizer Configuration</CardTitle>
          <CardDescription>
            Tune these parameters before running the ILP solver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <SliderField
            label="Productivity Rate"
            description="Orders per picker per productive hour"
            value={config.productivityRate}
            min={5}
            max={30}
            step={1}
            unit="OPH"
            extra={`Peak staffing needed: ${peakRequired} workers`}
            onChange={(v) => update("productivityRate", v)}
          />

          <SliderField
            label="Part-timer Cap"
            description="Maximum PT + WPT as a % of total workforce"
            value={config.partTimerCapPct}
            min={0}
            max={80}
            step={5}
            unit="%"
            onChange={(v) => update("partTimerCapPct", v)}
          />

          <SliderField
            label="Weekender Cap"
            description="Maximum WFT + WPT as a % of total workforce"
            value={config.weekenderCapPct}
            min={0}
            max={60}
            step={5}
            unit="%"
            onChange={(v) => update("weekenderCapPct", v)}
          />
        </CardContent>
      </Card>

      {/* Shift rules reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift Rules Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <ShiftRule
              type="FT"
              label="Full-time"
              hours="9h slot, 8h productive"
              starts="05:00 – 15:00"
              off="One weekday off (Mon–Fri)"
            />
            <ShiftRule
              type="PT"
              label="Part-time"
              hours="4h straight, no break"
              starts="05:00 – 20:00"
              off="One weekday off (Mon–Fri)"
            />
            <ShiftRule
              type="WFT"
              label="Weekend FT"
              hours="9h slot, 8h productive"
              starts="05:00 – 15:00"
              off="Mon–Fri (always off)"
            />
            <ShiftRule
              type="WPT"
              label="Weekend PT"
              hours="4h straight, no break"
              starts="05:00 – 20:00"
              off="Mon–Fri (always off)"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={() => onSolve(config)}
          disabled={solving}
          className="min-w-[220px]"
        >
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

interface SliderFieldProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  extra?: string;
  onChange: (v: number) => void;
}

function SliderField({ label, description, value, min, max, step, unit, extra, onChange }: SliderFieldProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <Badge variant="outline" className="text-base px-3 py-1 font-bold">
          {value} {unit}
        </Badge>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>{min}{unit}</span>
        {extra && <span className="text-blue-600 font-medium">{extra}</span>}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function ShiftRule({
  type,
  label,
  hours,
  starts,
  off,
}: {
  type: string;
  label: string;
  hours: string;
  starts: string;
  off: string;
}) {
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
