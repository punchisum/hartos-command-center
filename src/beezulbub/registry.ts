/**
 * src/beezulbub/registry.ts
 *
 * Registry of known HartOS-compatible capability targets and
 * built-in scout candidates for fixture/offline mode.
 */

import type { ScoutCandidate } from "./types.js";

// Known HartOS capability targets
export const CAPABILITY_TARGETS = [
  "dashboard_layout",
  "admin_table",
  "receipt_ocr",
  "pdf_parser",
  "csv_export",
  "supabase_auth_ui",
  "fitness_chart",
  "timeline_viewer",
  "file_upload",
  "agent_status_card",
  "launch_report_viewer",
  "markdown_editor",
  "data_grid",
  "kanban_board",
  "notification_center",
  "audit_log_viewer",
] as const;

export type CapabilityTarget = typeof CAPABILITY_TARGETS[number];

// Built-in fixture candidates for offline/fixture mode
export const BUILT_IN_CANDIDATES: Record<string, ScoutCandidate[]> = {
  dashboard_layout: [
    {
      name: "tremor-dashboard",
      sourceUrl: "https://github.com/tremorlabs/tremor",
      targetCapability: "dashboard_layout",
      reason: "React component library designed for dashboards. MIT licensed. Clean architecture.",
      estimatedValue: 8,
      licenseGuess: "MIT",
      staleRisk: "low",
      notes: "Tremor provides Tailwind-based dashboard components. Well-maintained, good tests.",
    },
    {
      name: "shadcn-dashboard",
      sourceUrl: "https://github.com/shadcn-ui/ui",
      targetCapability: "dashboard_layout",
      reason: "Copy-paste UI components built on Radix. MIT licensed. HartOS-friendly patterns.",
      estimatedValue: 9,
      licenseGuess: "MIT",
      staleRisk: "low",
      notes: "shadcn/ui is a collection of reusable components. No vendor lock-in.",
    },
  ],
  receipt_ocr: [
    {
      name: "tesseract-js-receipt",
      sourceUrl: "https://github.com/naptha/tesseract.js",
      targetCapability: "receipt_ocr",
      reason: "Pure JavaScript OCR engine. Apache 2.0. Works in browser and Node.",
      estimatedValue: 7,
      licenseGuess: "Apache-2.0",
      staleRisk: "low",
      notes: "Core OCR engine. Needs receipt-specific parsing layer on top.",
    },
  ],
  pdf_parser: [
    {
      name: "pdf-parse",
      sourceUrl: "https://www.npmjs.com/package/pdf-parse",
      targetCapability: "pdf_parser",
      reason: "PDF text extraction for Node. MIT licensed. Simple API.",
      estimatedValue: 6,
      licenseGuess: "MIT",
      staleRisk: "medium",
      notes: "Lightweight but limited OCR. Good for text-layer PDFs.",
    },
  ],
  csv_export: [
    {
      name: "papaparse",
      sourceUrl: "https://github.com/mholt/PapaParse",
      targetCapability: "csv_export",
      reason: "Fast, reliable CSV parser/generator. MIT. Battle-tested.",
      estimatedValue: 8,
      licenseGuess: "MIT",
      staleRisk: "low",
      notes: "Excellent CSV library. Works browser and Node. Easy to adapt.",
    },
  ],
};

export function getCandidatesForTarget(target: string): ScoutCandidate[] {
  return BUILT_IN_CANDIDATES[target] ?? [];
}

export function isKnownTarget(target: string): boolean {
  return CAPABILITY_TARGETS.includes(target as CapabilityTarget);
}
