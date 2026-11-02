import { callEngine } from "./engine";

export interface ReportWarning {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  partId?: string;
  measureIndex: number;
  element?: string;
}

/** The import report (§7.1 FR-IMP-003): source checksum and every warning. */
export interface ImportReport {
  sourceName: string;
  mediaType: string;
  sha256: string;
  size: number;
  warnings: ReportWarning[];
}

export function fetchReport(projectId: string): Promise<ImportReport> {
  return callEngine("report", [projectId]);
}
