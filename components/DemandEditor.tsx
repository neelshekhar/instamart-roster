"use client";

import { useRef } from "react";
import { BarChart3, Copy, Upload, FileText, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OphMatrix } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SAMPLE_WEEKDAY = [5,5,5,5,5,5, 20,20,50,50,50,20, 20,20,20,20,30,40, 50,50,80,80,30,10];
const SAMPLE_SAT     = [6,6,6,6,6,6, 24,24,60,60,60,24, 24,24,24,24,36,48, 60,60,96,96,36,12];
const SAMPLE_SUN     = [7,7,7,7,7,7, 29,29,72,72,72,29, 29,29,29,29,43,58, 72,72,115,115,43,14];

interface DemandEditorProps {
  oph: OphMatrix;
  onChange: (oph: OphMatrix) => void;
  onProceed: () => void;
}

export function DemandEditor({ oph, onChange, onProceed }: DemandEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCellChange = (dayIndex: number, hourIndex: number, value: string) => {
    const numValue = parseInt(value) || 0;
    const newOph = oph.map((row, d) =>
      d === dayIndex ? row.map((v, h) => (h === hourIndex ? numValue : v)) : [...row]
    );
    onChange(newOph);
  };

  const copyMonToAll = () => {
    const mondayRow = oph[0];
    onChange(oph.map((_, d) => (d === 0 ? [...mondayRow] : [...mondayRow])));
  };

  const loadSample = () => {
    onChange([
      [...SAMPLE_WEEKDAY],
      [...SAMPLE_WEEKDAY],
      [...SAMPLE_WEEKDAY],
      [...SAMPLE_WEEKDAY],
      [...SAMPLE_WEEKDAY],
      [...SAMPLE_SAT],
      [...SAMPLE_SUN],
    ]);
  };

  const downloadCsv = () => {
    const headers = ["Day", ...Array.from({ length: 24 }, (_, i) => `${i}:00`)].join(",");
    const rows = oph.map((hours, d) => [DAYS[d], ...hours].join(","));
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "demand_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const daysMap: Record<string, number> = {
        mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
      };
      const newOph: OphMatrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < 25) continue;
        const d = daysMap[parts[0].toLowerCase().slice(0, 3)];
        if (d === undefined) continue;
        for (let h = 0; h < 24; h++) newOph[d][h] = parseInt(parts[h + 1]) || 0;
      }
      onChange(newOph);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const maxVal = Math.max(...oph.flat(), 1);
  const totalDemand = oph.flat().reduce((a, b) => a + b, 0);

  const getColor = (val: number) => {
    if (val === 0) return undefined;
    const intensity = Math.max(0.1, val / maxVal);
    return `rgba(79, 70, 229, ${intensity * 0.8})`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-base">24-Hour Demand Heatmap</CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <button
                onClick={loadSample}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md border border-emerald-200 font-medium transition-colors"
              >
                <FileText className="w-3 h-3" />
                Sample Data
              </button>
              <button
                onClick={copyMonToAll}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-800 rounded-md border border-yellow-200 font-medium transition-colors"
              >
                <Copy className="w-3 h-3" />
                Copy Mon to All
              </button>
              <button
                onClick={downloadCsv}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-md border border-gray-300 font-medium transition-colors"
              >
                <Download className="w-3 h-3" />
                CSV Template
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md border border-indigo-200 font-medium transition-colors"
              >
                <Upload className="w-3 h-3" />
                Upload CSV
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 font-medium">
                  <th className="px-3 py-2 w-14 sticky left-0 bg-gray-50 z-20 border-r border-gray-200 text-left">
                    Day
                  </th>
                  {Array.from({ length: 24 }, (_, i) => (
                    <th key={i} className="px-1 py-2 text-center min-w-[36px]">
                      {i}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right sticky right-0 bg-gray-50 z-20 border-l border-gray-200">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {oph.map((hours, dayIndex) => (
                  <tr key={DAYS[dayIndex]}>
                    <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-200">
                      {DAYS[dayIndex]}
                    </td>
                    {hours.map((val, hourIndex) => (
                      <td key={hourIndex} className="p-0.5">
                        <input
                          type="number"
                          className="w-full h-8 text-center text-[10px] rounded outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                          style={{
                            backgroundColor: val > 0 ? getColor(val) : undefined,
                            color: val > maxVal * 0.5 ? "white" : undefined,
                          }}
                          value={val || ""}
                          placeholder="0"
                          min={0}
                          onChange={(e) => handleCellChange(dayIndex, hourIndex, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold text-indigo-600 sticky right-0 bg-white z-10 border-l border-gray-200">
                      {hours.reduce((a, b) => a + b, 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-400 italic">
            Enter orders (volume units) per hour. Use "Sample Data" to see a realistic example, or upload a CSV.
          </p>
        </CardContent>
      </Card>

      {/* Proceed button */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg border border-gray-200 px-4 py-3">
        <div className="text-sm text-gray-600">
          {totalDemand > 0 ? (
            <span>
              <span className="font-semibold text-gray-900">{totalDemand.toLocaleString()}</span> total orders across the week
            </span>
          ) : (
            <span className="text-gray-400">Enter demand data above, then proceed to configure the solver.</span>
          )}
        </div>
        <button
          onClick={onProceed}
          disabled={totalDemand === 0}
          className="text-sm font-medium px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Use This Demand →
        </button>
      </div>
    </div>
  );
}
