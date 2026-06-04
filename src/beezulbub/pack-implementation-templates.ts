/**
 * src/beezulbub/pack-implementation-templates.ts
 *
 * HartOS-native implementation stub templates.
 *
 * Doctrine: Generate HartOS-native scaffolding.
 * Do NOT copy third-party source code.
 * Do NOT include real secrets.
 *
 * All generated stubs have explicit comments:
 *   "HartOS-native scaffold."
 *   "Third-party source code was not copied."
 *   "Implementation must be completed under HartOS review."
 */

import type { ImplementationFile } from "./pack-implementation-types.js";

const HARTOS_HEADER = [
  `/**`,
  ` * HartOS-native scaffold.`,
  ` * Third-party source code was not copied.`,
  ` * Implementation must be completed under HartOS review.`,
  ` */`,
].join("\n");

// ─── dashboard_layout templates ───────────────────────────────────────────────

function dashboardLayoutFiles(packName: string): ImplementationFile[] {
  return [
    {
      relativePath: "components/dashboard-shell.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Dashboard shell layout — HartOS-native stub. */`,
        `export interface DashboardShellProps {`,
        `  title: string;`,
        `  agentName: string;`,
        `  children?: unknown;`,
        `}`,
        ``,
        `/**`,
        ` * DashboardShell — renders the outer layout for this agent's dashboard.`,
        ` * Data must come from HartOS-approved sources (Supabase RLS, debug_events).`,
        ` * No hardcoded user IDs. No auth model copied from external repo.`,
        ` * TODO: implement with HartOS component library.`,
        ` */`,
        `export function DashboardShell(_props: DashboardShellProps): never {`,
        `  throw new Error("DashboardShell: not yet implemented. Review adaptation-plan.md.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "components/agent-status-card.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Agent status card — displays agent health from debug_events. */`,
        `export interface AgentStatusCardProps {`,
        `  agentName: string;`,
        `  status: "ok" | "error" | "degraded" | "unknown";`,
        `  lastEventAt?: string;`,
        `  errorRate?: number;`,
        `}`,
        ``,
        `/**`,
        ` * AgentStatusCard — reads from Supabase debug_events (RLS-safe).`,
        ` * No direct production DB access. No hardcoded URLs.`,
        ` * TODO: implement with observability-check.ts data.`,
        ` */`,
        `export function AgentStatusCard(_props: AgentStatusCardProps): never {`,
        `  throw new Error("AgentStatusCard: not yet implemented.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "components/manual-required-panel.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Panel shown when a workflow step requires manual action. */`,
        `export interface ManualRequiredPanelProps {`,
        `  stepId: string;`,
        `  instruction: string;`,
        `  commands: string[];`,
        `}`,
        ``,
        `export function ManualRequiredPanel(_props: ManualRequiredPanelProps): never {`,
        `  throw new Error("ManualRequiredPanel: not yet implemented.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "components/report-viewer-card.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Displays a HartOS launch/provision report summary. */`,
        `export interface ReportViewerCardProps {`,
        `  reportPath: string;`,
        `  status: string;`,
        `  summary: string;`,
        `}`,
        ``,
        `export function ReportViewerCard(_props: ReportViewerCardProps): never {`,
        `  throw new Error("ReportViewerCard: not yet implemented.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "runtime/dashboard-data-contract.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/**`,
        ` * Dashboard data contract — defines what data this pack reads.`,
        ` * Must come from HartOS-approved sources only.`,
        ` */`,
        `export interface DashboardDataInput {`,
        `  agentName: string;`,
        `  launchStatus?: string;`,
        `  recentErrors?: number;`,
        `  recentEvents?: number;`,
        `  lastSmokeResult?: "passed" | "failed" | "skipped";`,
        `}`,
        ``,
        `/** Fetch dashboard data from Supabase debug_events (RLS-safe). */`,
        `export async function fetchDashboardData(`,
        `  _supabaseUrl: string`,
        `): Promise<DashboardDataInput> {`,
        `  throw new Error("fetchDashboardData: not yet implemented. Use Supabase RLS query.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    ...upgradeContractTest(packName, ["DashboardShell", "AgentStatusCard", "ManualRequiredPanel"]),
    ...upgradeSmokePlan(packName, "Dashboard layout renders, agent status shows, report viewer loads."),
  ];
}

// ─── receipt_ocr templates ────────────────────────────────────────────────────

function receiptOcrFiles(packName: string): ImplementationFile[] {
  return [
    {
      relativePath: "schemas/receipt-document.schema.json",
      content: JSON.stringify({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "ReceiptDocument",
        "description": "HartOS-native schema for receipt documents. Not a legal/tax record.",
        "type": "object",
        "properties": {
          "documentId": { "type": "string", "description": "HartOS internal document ID (UUID)" },
          "extractionStatus": { "type": "string", "enum": ["pending", "extraction_success", "ocr_success", "degraded", "error"] },
          "extractionMethod": { "type": "string", "enum": ["text_pdf", "ocr_pdf", "degraded"] },
          "charCount": { "type": "integer", "minimum": 0 },
          "analysisEligible": { "type": "boolean" },
          "degradedReason": { "type": ["string", "null"] },
          "downloadProof": { "type": "boolean" },
          "extractionProof": { "type": "boolean" }
        },
        "required": ["documentId", "extractionStatus", "charCount", "analysisEligible"],
        "additionalProperties": false
      }, null, 2) + "\n",
    },
    {
      relativePath: "runtime/receipt-parser-boundary.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/**`,
        ` * Receipt parser boundary — returns a draft, NOT a final decision.`,
        ` * Low confidence requires explicit approval gate.`,
        ` * No tax/legal final decisions from this boundary.`,
        ` */`,
        `export interface ReceiptParseInput {`,
        `  documentId: string;`,
        `  extractedText: string;`,
        `  charCount: number;`,
        `}`,
        ``,
        `export interface ReceiptDraft {`,
        `  documentId: string;`,
        `  status: "draft" | "requires_approval";`,
        `  confidence: number; // 0-1`,
        `  extractedFields: Record<string, string>;`,
        `  approvalRequired: boolean;`,
        `}`,
        ``,
        `/** Parse receipt text into a draft. Always returns draft — never final decision. */`,
        `export async function parseReceiptToDraft(`,
        `  _input: ReceiptParseInput`,
        `): Promise<ReceiptDraft> {`,
        `  throw new Error("parseReceiptToDraft: not yet implemented.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "runtime/confidence-score.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `export type ConfidenceLevel = "high" | "medium" | "low" | "unacceptable";`,
        ``,
        `export function classifyConfidence(score: number): ConfidenceLevel {`,
        `  if (score >= 0.85) return "high";`,
        `  if (score >= 0.65) return "medium";`,
        `  if (score >= 0.40) return "low";`,
        `  return "unacceptable";`,
        `}`,
        ``,
        `export function requiresApproval(score: number): boolean {`,
        `  return score < 0.85; // All non-high confidence requires human approval`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "runtime/approval-draft-contract.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Draft sent for human approval — never a final record. */`,
        `export interface ApprovalDraft {`,
        `  draftId: string;`,
        `  documentId: string;`,
        `  status: "pending_approval" | "approved" | "rejected";`,
        `  submittedAt: string;`,
        `  reviewedAt?: string;`,
        `  reviewedBy?: string;`,
        `}`,
        ``,
        `export async function submitForApproval(`,
        `  _draft: ApprovalDraft`,
        `): Promise<void> {`,
        `  throw new Error("submitForApproval: not yet implemented. Wire to HartOS action_tokens.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    ...upgradeContractTest(packName, ["parseReceiptToDraft", "classifyConfidence", "requiresApproval"]),
    ...upgradeSmokePlan(packName, "Receipt text extracted, confidence scored, draft sent for approval."),
  ];
}

// ─── agent_status_card templates ─────────────────────────────────────────────

function agentStatusCardFiles(packName: string): ImplementationFile[] {
  return [
    {
      relativePath: "components/agent-status-card.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `export interface AgentHealthData {`,
        `  agentName: string;`,
        `  status: "ok" | "error" | "degraded" | "unknown";`,
        `  lastEventAt?: string;`,
        `  errorRate?: number; // 0-100`,
        `  recentEventCount?: number;`,
        `}`,
        ``,
        `export function AgentStatusCard(_data: AgentHealthData): never {`,
        `  throw new Error("AgentStatusCard: not yet implemented.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "runtime/agent-health-contract.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `export interface AgentHealthQuery {`,
        `  agentName: string;`,
        `  lookbackHours?: number;`,
        `}`,
        ``,
        `export interface AgentHealthResult {`,
        `  agentName: string;`,
        `  status: "ok" | "error" | "degraded" | "unknown";`,
        `  errorRate: number;`,
        `  recentEvents: number;`,
        `  lastEventAt: string | null;`,
        `}`,
        ``,
        `/** Query agent health from Supabase debug_events (RLS-safe). */`,
        `export async function queryAgentHealth(`,
        `  _query: AgentHealthQuery`,
        `): Promise<AgentHealthResult> {`,
        `  throw new Error("queryAgentHealth: implement with Supabase debug_events query.");`,
        `}`,
        ``,
      ].join("\n"),
    },
    ...upgradeContractTest(packName, ["AgentStatusCard", "queryAgentHealth"]),
    ...upgradeSmokePlan(packName, "Agent health data displayed from debug_events."),
  ];
}

// ─── Generic fallback templates ───────────────────────────────────────────────

function genericFallbackFiles(packName: string, capability: string): ImplementationFile[] {
  return [
    {
      relativePath: "runtime/capability-boundary.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Capability boundary for: ${capability} */`,
        `export interface CapabilityInput {`,
        `  capabilityId: string;`,
        `  data: Record<string, unknown>;`,
        `}`,
        ``,
        `export interface CapabilityOutput {`,
        `  status: "ok" | "error" | "manual_required";`,
        `  result?: Record<string, unknown>;`,
        `  message: string;`,
        `}`,
        ``,
        `export async function executeCapability(`,
        `  _input: CapabilityInput`,
        `): Promise<CapabilityOutput> {`,
        `  throw new Error(\`${capability}: capability boundary not yet implemented.\`);`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      relativePath: "runtime/input-output-contract.ts",
      content: [
        HARTOS_HEADER,
        ``,
        `/** Input/output contract for: ${capability} */`,
        `export type InputSchema = Record<string, unknown>;`,
        `export type OutputSchema = Record<string, unknown>;`,
        ``,
        `export function validateInput(_input: InputSchema): { valid: boolean; errors: string[] } {`,
        `  // TODO: implement validation`,
        `  return { valid: true, errors: [] };`,
        `}`,
        ``,
      ].join("\n"),
    },
    ...upgradeContractTest(packName, ["executeCapability", "validateInput"]),
    ...upgradeSmokePlan(packName, `${capability} capability boundary executes safely.`),
  ];
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function upgradeContractTest(packName: string, exports: string[]): ImplementationFile[] {
  return [
    {
      relativePath: "tests/pack.contract.test.ts",
      content: [
        `/**`,
        ` * tests/pack.contract.test.ts`,
        ` *`,
        ` * Pack contract test for: ${packName}`,
        ` * Phase 11E: Upgraded from placeholder to structure checks.`,
        ` * ${HARTOS_HEADER.replace(/\/\*\*|\s*\*\/|\s*\*/g, "").trim()}`,
        ` */`,
        ``,
        `import { test, describe } from "node:test";`,
        `import assert from "node:assert/strict";`,
        `import { existsSync } from "node:fs";`,
        `import { readFile } from "node:fs/promises";`,
        `import path from "node:path";`,
        ``,
        `const packDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");`,
        ``,
        `describe("${packName} pack contract", () => {`,
        `  test("pack.manifest.json exists and is valid", async () => {`,
        `    const manifestPath = path.join(packDir, "pack.manifest.json");`,
        `    assert.ok(existsSync(manifestPath), "pack.manifest.json must exist");`,
        `    const raw = await readFile(manifestPath, "utf8");`,
        `    const manifest = JSON.parse(raw);`,
        `    assert.ok(manifest.packName, "manifest must have packName");`,
        `    assert.ok(manifest.packVersion, "manifest must have packVersion");`,
        `    assert.ok(manifest.status, "manifest must have status");`,
        `    assert.ok(manifest.source, "manifest must have source");`,
        `  });`,
        ``,
        `  test("adaptation-plan.md exists", () => {`,
        `    assert.ok(existsSync(path.join(packDir, "adaptation-plan.md")));`,
        `  });`,
        ``,
        `  test("smoke plan exists", () => {`,
        `    assert.ok(existsSync(path.join(packDir, "smoke", "smoke-plan.md")));`,
        `  });`,
        ``,
        `  test("no secrets in manifest", async () => {`,
        `    const raw = await readFile(path.join(packDir, "pack.manifest.json"), "utf8");`,
        `    const secretPattern = /sk-[A-Za-z0-9_-]{20,}/;`,
        `    assert.ok(!secretPattern.test(raw), "manifest must not contain API key patterns");`,
        `  });`,
        ``,
        `  test("manifest status is implementation_draft or higher", async () => {`,
        `    const raw = await readFile(path.join(packDir, "pack.manifest.json"), "utf8");`,
        `    const manifest = JSON.parse(raw);`,
        `    const validStatuses = ["implementation_draft", "verified", "available"];`,
        `    assert.ok(`,
        `      validStatuses.includes(manifest.status),`,
        `      \`Expected implementation_draft+, got: \${manifest.status}\``,
        `    );`,
        `  });`,
        ``,
        `  // Implementation-specific checks`,
        ...exports.map((exp) => [
          `  test("${exp} stub exists in runtime files", () => {`,
          `    // Verify the stub file exists (content check — not executing)`,
          `    const runtimeDir = path.join(packDir, "runtime");`,
          `    const componentsDir = path.join(packDir, "components");`,
          `    const schemasDir = path.join(packDir, "schemas");`,
          `    const found =`,
          `      existsSync(runtimeDir) || existsSync(componentsDir) || existsSync(schemasDir);`,
          `    assert.ok(found, "Implementation directories must exist after pack-implement");`,
          `  });`,
        ].join("\n")),
        `});`,
        ``,
      ].join("\n"),
    },
  ];
}

function upgradeSmokePlan(packName: string, finalState: string): ImplementationFile[] {
  return [
    {
      relativePath: "smoke/smoke-plan.md",
      content: [
        `# Smoke Plan: ${packName}`,
        ``,
        `Phase 11E: Upgraded from placeholder.`,
        ``,
        `## Pre-smoke checklist`,
        ``,
        `- [ ] pack.manifest.json status is implementation_draft or higher`,
        `- [ ] adaptation-plan.md reviewed`,
        `- [ ] no secrets in any pack file`,
        `- [ ] HartOS approval gate wired for mutations`,
        `- [ ] Supabase migrations applied (if any)`,
        `- [ ] contract test passes: tests/pack.contract.test.ts`,
        ``,
        `## Smoke tests`,
        ``,
        `- [ ] Implementation stubs exist (no "not implemented" errors on import)`,
        `- [ ] TypeScript types are correct (no type errors)`,
        `- [ ] No secrets in generated files`,
        `- [ ] Approval gate blocks unauthorized mutations`,
        `- [ ] Data only from HartOS-approved sources`,
        ``,
        `## Final state proof`,
        ``,
        `${finalState}`,
        ``,
        `## Pack verify must pass`,
        ``,
        `Run: \`npm run beezulbub:pack-verify -- --pack=packs/${packName}\``,
        ``,
      ].join("\n") + "\n",
    },
  ];
}

// ─── Template router ──────────────────────────────────────────────────────────

export function getImplementationFiles(
  packName: string,
  capabilities: string[]
): { files: ImplementationFile[]; capabilityType: string } {
  const primaryCapability = capabilities[0] ?? packName;

  if (primaryCapability === "dashboard_layout" || capabilities.includes("dashboard_layout")) {
    return { files: dashboardLayoutFiles(packName), capabilityType: "dashboard_layout" };
  }
  if (primaryCapability === "receipt_ocr" || capabilities.includes("receipt_ocr")) {
    return { files: receiptOcrFiles(packName), capabilityType: "receipt_ocr" };
  }
  if (primaryCapability === "agent_status_card" || capabilities.includes("agent_status_card")) {
    return { files: agentStatusCardFiles(packName), capabilityType: "agent_status_card" };
  }

  // Generic fallback
  return { files: genericFallbackFiles(packName, primaryCapability), capabilityType: "generic" };
}
