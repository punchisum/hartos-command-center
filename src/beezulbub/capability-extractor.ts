/**
 * src/beezulbub/capability-extractor.ts
 *
 * Identify extractable capabilities from a digested repository.
 * Maps detected stack/files/patterns to HartOS capability targets.
 */

import type { ExtractableCapability } from "./types.js";

interface CapabilitySignature {
  id: string;
  name: string;
  description: string;
  triggers: Array<{ type: "dependency" | "framework" | "file" | "script"; value: string }>;
  hartosPackTarget: string;
  requiredTests: string[];
  requiredEnvVars: string[];
  requiredProviderAdapters: string[];
  requiredDbChanges: string[];
  securityNotes: string[];
  estimatedEffort: "low" | "medium" | "high";
  absorb: string[];
  reject: string[];
}

const CAPABILITY_SIGNATURES: CapabilitySignature[] = [
  {
    id: "dashboard_layout",
    name: "Dashboard Layout",
    description: "Responsive dashboard shell with navigation, cards, and metrics layout",
    triggers: [
      { type: "dependency", value: "recharts" },
      { type: "dependency", value: "tremor" },
      { type: "dependency", value: "@shadcn/ui" },
      { type: "file", value: "Dashboard" },
      { type: "file", value: "dashboard" },
    ],
    hartosPackTarget: "dashboard-pack",
    requiredTests: ["layout-render smoke", "no-secret-leak", "role-guard"],
    requiredEnvVars: [],
    requiredProviderAdapters: [],
    requiredDbChanges: [],
    securityNotes: ["Remove any auth model — HartOS handles auth via Telegram/webhook allowlists"],
    estimatedEffort: "low",
    absorb: ["layout shell", "card components", "metric display", "table patterns"],
    reject: ["auth model", "deployment config", "database schema", "vendor-specific charts"],
  },
  {
    id: "admin_table",
    name: "Admin Data Table",
    description: "Sortable, filterable data table for admin interfaces",
    triggers: [
      { type: "dependency", value: "tanstack/react-table" },
      { type: "dependency", value: "@tanstack/react-table" },
      { type: "dependency", value: "react-table" },
      { type: "file", value: "DataTable" },
      { type: "file", value: "AdminTable" },
    ],
    hartosPackTarget: "admin-pack",
    requiredTests: ["table-render", "sort-filter", "pagination"],
    requiredEnvVars: [],
    requiredProviderAdapters: ["supabase"],
    requiredDbChanges: ["Connect to Supabase REST API for data fetching"],
    securityNotes: ["Ensure row-level security applied. No raw SQL exposure."],
    estimatedEffort: "medium",
    absorb: ["table component", "sort logic", "filter logic", "pagination"],
    reject: ["data fetching layer", "auth assumptions", "custom query builder"],
  },
  {
    id: "pdf_parser",
    name: "PDF Text Extraction",
    description: "Extract text content from PDF files",
    triggers: [
      { type: "dependency", value: "pdf-parse" },
      { type: "dependency", value: "pdfjs-dist" },
      { type: "dependency", value: "pdf2json" },
      { type: "dependency", value: "pdfreader" },
    ],
    hartosPackTarget: "file-extraction-pack",
    requiredTests: ["text-extraction smoke", "scanned-pdf-degrades-safely", "no-llm-if-no-text"],
    requiredEnvVars: [],
    requiredProviderAdapters: [],
    requiredDbChanges: [],
    securityNotes: ["Apply HartOS MIN_USEFUL_CHARS threshold. Use degraded state for scanned PDFs."],
    estimatedEffort: "low",
    absorb: ["PDF extraction logic", "text layer detection", "page iteration"],
    reject: ["custom file storage", "hardcoded paths", "synchronous blocking IO"],
  },
  {
    id: "csv_export",
    name: "CSV Export",
    description: "Generate and download CSV files from data",
    triggers: [
      { type: "dependency", value: "papaparse" },
      { type: "dependency", value: "csv-stringify" },
      { type: "dependency", value: "fast-csv" },
      { type: "file", value: "csvExport" },
      { type: "file", value: "exportCsv" },
    ],
    hartosPackTarget: "export-pack",
    requiredTests: ["csv-generate", "download-trigger", "no-secret-in-export"],
    requiredEnvVars: [],
    requiredProviderAdapters: [],
    requiredDbChanges: [],
    securityNotes: ["Ensure exported data respects RLS. Never export service role data."],
    estimatedEffort: "low",
    absorb: ["CSV generation logic", "download trigger", "column mapping"],
    reject: ["server-side data access", "auth bypass for exports"],
  },
  {
    id: "receipt_ocr",
    name: "Receipt OCR",
    description: "Optical character recognition for receipt images",
    triggers: [
      { type: "dependency", value: "tesseract.js" },
      { type: "dependency", value: "@google-cloud/vision" },
      { type: "file", value: "receipt" },
      { type: "file", value: "OCR" },
      { type: "file", value: "ocr" },
    ],
    hartosPackTarget: "receipt-pack",
    requiredTests: ["ocr-text-extraction", "degraded-state-for-unclear-image", "char-count-threshold"],
    requiredEnvVars: ["OPENAI_API_KEY (if vision path)"],
    requiredProviderAdapters: ["openai (optional)"],
    requiredDbChanges: ["receipt_scans table with extraction_status, char_count"],
    securityNotes: [
      "Apply HartOS file extraction contract (MIN_USEFUL_CHARS=100)",
      "Use degraded state honestly — never claim analysis if text extraction failed",
    ],
    estimatedEffort: "high",
    absorb: ["OCR engine integration", "image preprocessing", "text extraction"],
    reject: ["proprietary OCR APIs without abstraction", "hardcoded API keys", "sync blocking IO"],
  },
  {
    id: "file_upload",
    name: "File Upload Component",
    description: "Drag-and-drop file upload with progress and validation",
    triggers: [
      { type: "dependency", value: "react-dropzone" },
      { type: "dependency", value: "multer" },
      { type: "file", value: "FileUpload" },
      { type: "file", value: "Dropzone" },
      { type: "file", value: "upload" },
    ],
    hartosPackTarget: "file-intake-pack",
    requiredTests: ["upload-renders", "validates-file-type", "validates-file-size"],
    requiredEnvVars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY (for storage)"],
    requiredProviderAdapters: ["supabase"],
    requiredDbChanges: ["file_uploads table with status, mime_type, size"],
    securityNotes: ["Validate file type server-side. Apply size limits. Scan for malware if needed."],
    estimatedEffort: "medium",
    absorb: ["dropzone UI", "file validation logic", "progress display"],
    reject: ["direct S3/storage assumptions", "unvalidated file types", "no size limits"],
  },
];

function matchesTrigger(
  trigger: CapabilitySignature["triggers"][number],
  context: {
    dependencies: string[];
    frameworks: string[];
    filePaths: string[];
    scripts: Record<string, string>;
  }
): boolean {
  switch (trigger.type) {
    case "dependency":
      return context.dependencies.some(
        (d) => d === trigger.value || d.startsWith(trigger.value + "@")
      );
    case "framework":
      return context.frameworks.includes(trigger.value);
    case "file":
      return context.filePaths.some((f) =>
        f.toLowerCase().includes(trigger.value.toLowerCase())
      );
    case "script":
      return Object.values(context.scripts).some((s) =>
        s.includes(trigger.value)
      );
  }
}

export function extractCapabilities(context: {
  dependencies: string[];
  devDependencies: string[];
  frameworks: string[];
  filePaths: string[];
  scripts: Record<string, string>;
  targetCapability?: string;
}): ExtractableCapability[] {
  const allDeps = [...context.dependencies, ...context.devDependencies];
  const searchContext = { ...context, dependencies: allDeps };

  const found: ExtractableCapability[] = [];

  for (const sig of CAPABILITY_SIGNATURES) {
    // If a specific target is requested, filter
    if (context.targetCapability && sig.id !== context.targetCapability) continue;

    // Check if any trigger matches
    const matched = sig.triggers.some((trigger) => matchesTrigger(trigger, searchContext));
    if (!matched) continue;

    // Find which files matched
    const matchedFiles = context.filePaths.filter((f) =>
      sig.triggers
        .filter((t) => t.type === "file")
        .some((t) => f.toLowerCase().includes(t.value.toLowerCase()))
    );

    found.push({
      id: sig.id,
      name: sig.name,
      description: sig.description,
      files: matchedFiles.length > 0 ? matchedFiles : undefined,
      absorb: sig.absorb,
      reject: sig.reject,
      hartosPackTarget: sig.hartosPackTarget,
      requiredTests: sig.requiredTests,
      requiredEnvVars: sig.requiredEnvVars,
      requiredProviderAdapters: sig.requiredProviderAdapters,
      requiredDbChanges: sig.requiredDbChanges,
      securityNotes: sig.securityNotes,
      estimatedEffort: sig.estimatedEffort,
    });
  }

  return found;
}
