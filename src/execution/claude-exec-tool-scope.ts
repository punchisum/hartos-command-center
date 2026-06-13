/**
 * src/execution/claude-exec-tool-scope.ts — W3: the code-edit-only tool-scope guard (PURE).
 *
 * The claude.execute hand must never be handed a tool that can run commands, reach the network, or
 * touch anything outside file edits. This turns "we pass --allowedTools Read,Edit,Write,Glob,Grep"
 * from a convention into an ASSERTED invariant: any tool not on the code-edit allowlist makes the
 * scope unsafe (fail-closed), so a future edit that smuggles in Bash is caught here, not in prod.
 */

/** The ONLY tools the execution hand may ever be given — file reads + edits, nothing else. */
export const CODE_EDIT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"] as const;

export interface ToolScopeVerdict {
  safe: boolean;
  /** The parsed, trimmed, non-empty tool list (in input order). */
  tools: string[];
  reason: string;
}

/** Parse a comma-separated allowedTools string and assert every tool is code-edit-only. Fail-closed. */
export function assertCodeEditScope(allowedTools: string): ToolScopeVerdict {
  const tools = allowedTools
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tools.length === 0) {
    return { safe: false, tools, reason: "empty tool scope" };
  }
  const allow = new Set<string>(CODE_EDIT_TOOLS);
  const offenders = tools.filter((t) => !allow.has(t));
  if (offenders.length > 0) {
    return { safe: false, tools, reason: `non-code-edit tool(s) in scope: ${offenders.join(", ")}` };
  }
  return { safe: true, tools, reason: "code-edit-only scope" };
}
