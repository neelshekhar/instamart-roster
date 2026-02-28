"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseFile, generateSampleMatrix, getDefaultMatrix, matrixToCsv } from "@/lib/parser";
import type { OphMatrix } from "@/lib/types";

interface FileUploadProps {
  onMatrixReady: (matrix: OphMatrix) => void;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function FileUpload({ onMatrixReady }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string>("sample-oph-matrix.csv");
  const [matrix, setMatrix] = useState<OphMatrix>(() => getDefaultMatrix());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseFile(file);
      setMatrix(parsed);
      setFileName(file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const loadSample = useCallback(() => {
    const sample = generateSampleMatrix();
    setMatrix(sample);
    setFileName("sample-demand.csv");
    setError(null);
  }, []);

  const downloadSampleCsv = useCallback(() => {
    const sample = generateSampleMatrix();
    const csv = matrixToCsv(sample);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-oph-matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleConfirm = useCallback(() => {
    if (matrix) onMatrixReady(matrix);
  }, [matrix, onMatrixReady]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload OPH Demand Matrix</CardTitle>
          <CardDescription>
            Upload an Excel (.xlsx) or CSV file with 7 rows (Mon–Sun) × 24 columns (hours 0–23).
            First row/column may contain labels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer
              ${isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
            `}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex flex-col items-center gap-3">
              <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {loading ? (
                <p className="text-gray-500">Parsing file…</p>
              ) : (
                <>
                  <p className="text-gray-600 font-medium">Drop your Excel/CSV file here</p>
                  <p className="text-sm text-gray-400">or click to browse</p>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={loadSample}>
              Load Sample Data
            </Button>
            <Button variant="outline" size="sm" onClick={downloadSampleCsv}>
              Download Sample CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Matrix preview */}
      {matrix && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Preview: {fileName}</CardTitle>
                <CardDescription>7 days × 24 hours — orders per hour</CardDescription>
              </div>
              <Badge variant="secondary">7 × 24</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>
                    <th className="border border-gray-200 px-2 py-1 bg-gray-50 text-left font-medium">Day</th>
                    {HOURS.map((h) => (
                      <th key={h} className="border border-gray-200 px-1 py-1 bg-gray-50 text-center font-medium min-w-[28px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, d) => {
                    const maxVal = Math.max(...row);
                    return (
                      <tr key={d}>
                        <td className="border border-gray-200 px-2 py-1 font-medium bg-gray-50">
                          {DAYS[d]}
                        </td>
                        {row.map((val, h) => {
                          const intensity = maxVal > 0 ? val / maxVal : 0;
                          const bg = intensity > 0
                            ? `rgba(59, 130, 246, ${0.1 + intensity * 0.5})`
                            : "transparent";
                          return (
                            <td
                              key={h}
                              className="border border-gray-200 px-1 py-1 text-center"
                              style={{ backgroundColor: bg }}
                            >
                              {val > 0 ? val : ""}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleConfirm}>
                Use This Data →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
