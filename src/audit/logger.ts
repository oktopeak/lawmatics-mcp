import { appendFile, mkdir } from "fs/promises";
import { homedir } from "os";
import path from "path";

export type AuditEntry = {
  tool: string;
  outcome: "success" | "error" | "blocked";
  args?: Record<string, unknown>;
  result_count?: number;
  error?: string;
};

function auditEnabled(): boolean {
  const raw = process.env.LAWMATICS_AUDIT_LOG;
  return raw !== "0" && raw !== "false";
}

function auditPath(): string {
  return process.env.LAWMATICS_AUDIT_LOG_PATH ?? path.join(homedir(), ".lawmatics-mcp", "audit.log");
}

let warned = false;

/**
 * Append-only JSONL audit trail of every tool call, written locally.
 * Never throws — an unwritable audit log must not break tool calls, but the
 * failure is surfaced once on stderr.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  if (!auditEnabled()) return;
  try {
    const file = auditPath();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error(
        `[lawmatics-mcp] WARNING: could not write audit log (${(err as Error).message}). ` +
          "Set LAWMATICS_AUDIT_LOG_PATH to a writable location or LAWMATICS_AUDIT_LOG=0 to disable."
      );
    }
  }
}
