import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LawmaticsApiError,
  lawmaticsGetAll,
  lawmaticsGetList,
  type FetchAllResult,
  type ListResult,
  type QueryParams,
} from "./lawmatics-client.js";
import { auditLog } from "./audit/logger.js";

export function isReadOnly(): boolean {
  const raw = process.env.LAWMATICS_READ_ONLY;
  return raw === "1" || raw === "true";
}

export function experimentalEnabled(): boolean {
  return process.env.LAWMATICS_EXPERIMENTAL_TOOLS === "1";
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

type RegisterOptions = {
  name: string;
  description: string;
  /** Write tools are NOT registered at all when LAWMATICS_READ_ONLY is set. */
  write?: boolean;
  schema: z.ZodRawShape;
  /** Return any JSON-serializable value; wrapping, auditing, and errors are handled here. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool types its own args; zod validates at runtime
  handler: (args: any) => Promise<unknown>;
};

/**
 * Single registration path for every tool so error handling, the read-only
 * gate, and the audit trail cannot drift between tools.
 */
export function registerTool(server: McpServer, opts: RegisterOptions): void {
  if (opts.write && isReadOnly()) return;

  server.tool(opts.name, opts.description, opts.schema, (async (args: Record<string, unknown>) => {
    try {
      const data = await opts.handler(args);
      const count = Array.isArray((data as { items?: unknown[] })?.items)
        ? (data as { items: unknown[] }).items.length
        : undefined;
      await auditLog({
        tool: opts.name,
        outcome: "success",
        args,
        ...(count !== undefined ? { result_count: count } : {}),
      });
      return jsonResult(data);
    } catch (err: unknown) {
      if (err instanceof LawmaticsApiError && err.status === 404) {
        await auditLog({ tool: opts.name, outcome: "success", args, result_count: 0 });
        // Not-found is data, not a tool failure — the model should treat it as an answer.
        return jsonResult({ error: err.message, not_found: true });
      }
      const msg = err instanceof Error ? err.message : String(err);
      await auditLog({ tool: opts.name, outcome: "error", args, error: msg });
      return { content: [{ type: "text" as const, text: `Error in ${opts.name}: ${msg}` }], isError: true };
    }
  }) as never);
}

// ---------------------------------------------------------------------------
// Shared list plumbing — every list endpoint takes the same query surface.
// ---------------------------------------------------------------------------

export const listParamsSchema = {
  page: z.number().int().min(1).optional().describe("Page number (Lawmatics returns a fixed 25 records per page)."),
  sort_by: z
    .string()
    .optional()
    .describe("Attribute to sort by, e.g. 'created_at', 'updated_at', 'id'. Default: id, newest first."),
  sort_order: z.enum(["asc", "desc"]).optional(),
  filter_by: z
    .string()
    .optional()
    .describe(
      "Attribute to filter on. IMPORTANT: the Lawmatics API supports only ONE filter per request. " +
        "Association filters use the _id suffix, e.g. practice_area_id, stage_id, source_id, matter_id, contact_id."
    ),
  filter_on: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Value to filter for. Required with filter_by unless filter_with is null/not_null."),
  filter_with: z
    .string()
    .optional()
    .describe(
      "Filter operator: =, !=, <, <=, >, >=, like, ilike (default: ilike for text — add % wildcards for fuzzy match, " +
        "e.g. %smith%), or presence checks: null, not_null. Currency values are in cents."
    ),
  fields: z
    .string()
    .optional()
    .describe(
      "Comma-separated attributes to return, or 'all' for everything. Add 'custom_fields' to include custom field values."
    ),
  fetch_all: z
    .boolean()
    .optional()
    .describe(
      "Follow pagination and return every record (capped at 1,000). The response says complete=false if truncated."
    ),
};

export type ListArgs = {
  page?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  filter_by?: string;
  filter_on?: string | number;
  filter_with?: string;
  fields?: string;
  fetch_all?: boolean;
};

const PRESENCE_OPERATORS = new Set(["null", "not_null", "empty", "present", "blank"]);

/**
 * Run a list query with the shared param surface. Validates the one-filter
 * rules up front so the model gets a actionable message instead of a raw 422.
 */
export async function runList(
  path: string,
  args: ListArgs,
  defaults?: { fields?: string; extraParams?: QueryParams }
): Promise<ListResult | FetchAllResult> {
  if (args.filter_by && args.filter_on === undefined && !PRESENCE_OPERATORS.has(args.filter_with ?? "")) {
    throw new LawmaticsApiError(
      422,
      "filter_by was given without filter_on. Provide filter_on, or use filter_with: 'null' / 'not_null' for presence checks."
    );
  }
  if (args.filter_on !== undefined && !args.filter_by) {
    throw new LawmaticsApiError(422, "filter_on was given without filter_by. Name the attribute to filter on.");
  }

  const params: QueryParams = {
    ...(defaults?.extraParams ?? {}),
    sort_by: args.sort_by,
    sort_order: args.sort_order,
    filter_by: args.filter_by,
    filter_on: args.filter_on,
    filter_with: args.filter_with,
    fields: args.fields ?? defaults?.fields,
  };

  if (args.fetch_all) {
    return lawmaticsGetAll(path, params, args.page ?? 1);
  }
  return lawmaticsGetList(path, { ...params, page: args.page ?? 1 });
}
