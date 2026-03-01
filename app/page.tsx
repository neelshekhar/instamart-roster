"use client";

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/FileUpload";
import { DemandEditor } from "@/components/DemandEditor";
import { ConfigPanel } from "@/components/ConfigPanel";
import { ResultsSummary } from "@/components/ResultsSummary";
import { RosterTable } from "@/components/RosterTable";
import { CoverageChart } from "@/components/CoverageChart";
import { UtilizationHeatmap } from "@/components/UtilizationHeatmap";
import { WeeklyOverviewChart } from "@/components/WeeklyOverviewChart";
import { runOptimizer } from "@/lib/optimizer";
import type { OphMatrix, OptimizerConfig, SolverResult } from "@/lib/types";

type Step = "upload" | "configure" | "results";
type InputTab = "upload" | "manual";

const EMPTY_OPH: OphMatrix = Array.from({ length: 7 }, () => new Array(24).fill(0));

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [inputTab, setInputTab] = useState<InputTab>("upload");
  const [oph, setOph] = useState<OphMatrix | null>(null);
  const [editOph, setEditOph] = useState<OphMatrix>(EMPTY_OPH);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [config, setConfig] = useState<OptimizerConfig | null>(null);
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleMatrixReady = useCallback((matrix: OphMatrix) => {
    setOph(matrix);
    setEditOph(matrix); // keep manual editor in sync
    setStep("configure");
    setResult(null);
    setError(null);
  }, []);

  const handleSolve = useCallback(async (cfg: OptimizerConfig) => {
    if (!oph) return;
    setSolving(true);
    setError(null);
    setProgress("Starting optimizer…");
    setConfig(cfg);

    try {
      const res = await runOptimizer({ oph, config: cfg }, (msg) => setProgress(msg));
      setResult(res);
      if (res.status === "optimal") {
        setStep("results");
      } else {
        setError(`Solver returned status: ${res.status}. ${res.errorMessage ?? ""}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSolving(false);
      setProgress("");
    }
  }, [oph]);

  const stepIdx: Record<Step, number> = { upload: 0, configure: 1, results: 2 };
  const currentIdx = stepIdx[step];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Instamart Roster Optimizer</h1>
            <p className="text-sm text-gray-500">ILP-based weekly picker scheduling · minimises total labour hours</p>
          </div>
          <div className="flex items-center gap-2">
            {(["Upload", "Configure", "Results"] as const).map((label, i) => (
              <div key={label} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-300 text-xs">→</span>}
                <button
                  onClick={() => {
                    if (i === 0) setStep("upload");
                    if (i === 1 && oph) setStep("configure");
                    if (i === 2 && result) setStep("results");
                  }}
                  disabled={i > currentIdx}
                  className={`text-sm px-3 py-1 rounded-full transition-colors ${
                    i === currentIdx
                      ? "bg-blue-600 text-white font-medium"
                      : i < currentIdx
                      ? "text-blue-600 hover:bg-blue-50 cursor-pointer"
                      : "text-gray-400 cursor-default"
                  }`}
                >
                  {i + 1}. {label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            {/* Input mode tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
              <button
                onClick={() => setInputTab("upload")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  inputTab === "upload"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Upload File
              </button>
              <button
                onClick={() => setInputTab("manual")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  inputTab === "manual"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Edit Manually
              </button>
            </div>

            {inputTab === "upload" && (
              <FileUpload onMatrixReady={handleMatrixReady} />
            )}
            {inputTab === "manual" && (
              <DemandEditor
                oph={editOph}
                onChange={setEditOph}
                onProceed={() => handleMatrixReady(editOph)}
              />
            )}
          </div>
        )}

        {/* Step 2: Configure & Solve */}
        {step === "configure" && oph && (
          <div className="space-y-4">
            {solving && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm text-blue-800">
                <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {progress || "Solving…"}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                <strong>Error:</strong> {error}
              </div>
            )}
            <ConfigPanel oph={oph} onSolve={handleSolve} solving={solving} />
          </div>
        )}

        {/* Step 3: Results */}
        {step === "results" && result && config && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Optimal Roster</h2>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    result.status === "optimal"
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }
                >
                  {result.status}
                </Badge>
                <button
                  onClick={() => setStep("configure")}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Re-configure →
                </button>
              </div>
            </div>

            <ResultsSummary result={result} />

            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Weekly Overview</TabsTrigger>
                <TabsTrigger value="heatmap">Utilization Heatmap</TabsTrigger>
                <TabsTrigger value="chart">Coverage Chart</TabsTrigger>
                <TabsTrigger value="roster">Roster Table</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-4">
                <WeeklyOverviewChart result={result} />
              </TabsContent>
              <TabsContent value="heatmap" className="mt-4">
                <UtilizationHeatmap result={result} />
              </TabsContent>
              <TabsContent value="chart" className="mt-4">
                <CoverageChart result={result} />
              </TabsContent>
              <TabsContent value="roster" className="mt-4">
                <RosterTable result={result} config={config} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-8 text-center text-xs text-gray-400">
        Solved by Google OR-Tools CP-SAT · Minimises total paid hours · Built by Neelshekhar
      </footer>
    </div>
  );
}
