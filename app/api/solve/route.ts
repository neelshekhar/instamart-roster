import { spawn } from "child_process";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import type { SolverInput, SolverResult } from "@/lib/types";

export const runtime = "nodejs";

const SCRIPT = path.join(process.cwd(), "lib", "solver_cpsat.py");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const input = (await req.json()) as SolverInput;

  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", [SCRIPT]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    py.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    py.on("close", (code) => {
      if (code !== 0) {
        const errResult: SolverResult = {
          status: "error",
          errorMessage: `Python process exited with code ${code}: ${stderr.slice(0, 500)}`,
          workers: [], totalWorkers: 0,
          ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
          coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
          required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        };
        resolve(NextResponse.json(errResult));
        return;
      }

      try {
        const result = JSON.parse(stdout) as SolverResult;
        resolve(NextResponse.json(result));
      } catch {
        const errResult: SolverResult = {
          status: "error",
          errorMessage: `Failed to parse solver output: ${stdout.slice(0, 200)}`,
          workers: [], totalWorkers: 0,
          ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
          coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
          required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        };
        resolve(NextResponse.json(errResult));
      }
    });

    py.on("error", (err) => {
      const errResult: SolverResult = {
        status: "error",
        errorMessage: `Failed to spawn python3: ${err.message}`,
        workers: [], totalWorkers: 0,
        ftCount: 0, ptCount: 0, wftCount: 0, wptCount: 0,
        coverage: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        required: Array.from({ length: 7 }, () => new Array(24).fill(0)),
      };
      resolve(NextResponse.json(errResult));
    });

    py.stdin.write(JSON.stringify(input));
    py.stdin.end();
  });
}
