import * as XLSX from "xlsx";
import type { OphMatrix } from "./types";

/**
 * Parse an uploaded File (Excel or CSV) into a 7×24 OphMatrix.
 * Rows = days (Mon–Sun), Columns = hours (0–23).
 * The first row/column may be headers — we auto-detect and skip them.
 */
export async function parseFile(file: File): Promise<OphMatrix> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to 2-D array of raw values
  const raw: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(
    sheet,
    { header: 1, defval: 0 }
  );

  // Filter out completely empty rows
  const nonEmpty = raw.filter((row) => row.some((cell) => cell !== 0 && cell !== "" && cell !== undefined));

  return extractMatrix(nonEmpty);
}

function extractMatrix(rows: (string | number | undefined)[][]): OphMatrix {
  // Determine if first row is a header (non-numeric content)
  let startRow = 0;
  const firstCell = rows[0]?.[0];
  if (typeof firstCell === "string" && isNaN(Number(firstCell))) {
    startRow = 1;
  }

  // Determine if first column is a header
  let startCol = 0;
  const secondCell = rows[startRow]?.[0];
  if (typeof secondCell === "string" && isNaN(Number(secondCell))) {
    startCol = 1;
  }

  const dataRows = rows.slice(startRow, startRow + 7);

  if (dataRows.length < 7) {
    throw new Error(
      `Expected 7 data rows (Mon–Sun), got ${dataRows.length}. Please check your file format.`
    );
  }

  const matrix: OphMatrix = dataRows.map((row, rowIdx) => {
    const dataRow = (row as (string | number | undefined)[]).slice(startCol, startCol + 24);
    if (dataRow.length < 24) {
      throw new Error(
        `Row ${rowIdx + 1} has only ${dataRow.length} columns — expected 24 (one per hour).`
      );
    }
    return dataRow.map((cell) => {
      const val = typeof cell === "number" ? cell : parseFloat(String(cell ?? "0"));
      return isNaN(val) || val < 0 ? 0 : val;
    });
  });

  return matrix;
}

/**
 * Generate a sample 7×24 OPH matrix for demo / testing purposes.
 */
export function generateSampleMatrix(): OphMatrix {
  const matrix: OphMatrix = [];
  for (let d = 0; d < 7; d++) {
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      // Simulated demand: peak around 10-14 and 18-21, quiet at night
      let demand = 0;
      if (h >= 6 && h <= 22) {
        const morning = Math.max(0, 80 - Math.abs(h - 11) * 15);
        const evening = Math.max(0, 100 - Math.abs(h - 19) * 20);
        demand = Math.max(morning, evening);
        // Weekend boost
        if (d >= 5) demand = Math.round(demand * 1.3);
        // Add some noise
        demand = Math.max(0, demand + Math.round((Math.random() - 0.5) * 20));
      }
      row.push(demand);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Convert an OphMatrix to a downloadable CSV string for reference.
 */
export function matrixToCsv(matrix: OphMatrix): string {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const header = ["Day", ...hours].join(",");
  const rows = matrix.map((row, i) => [days[i], ...row].join(","));
  return [header, ...rows].join("\n");
}
