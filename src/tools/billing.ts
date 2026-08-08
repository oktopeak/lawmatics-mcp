import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerBillingTools(server: McpServer): void {
  registerTool(server, {
    name: "list-invoices",
    description:
      "List invoices (read-only in the Lawmatics API). Amounts are integer cents. " +
      "Useful filters: status, due_at, matter_id. Fields include amount_cents, amount_paid_cents, " +
      "outstanding_amount_cents, due_at, pdf_url.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/invoices", args),
  });
}
