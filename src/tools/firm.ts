import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsGetOne } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

/**
 * Firm-level reference data: pipelines, stages, practice areas, marketing
 * sources, sub-statuses, and users. These are the lookup tables the model
 * needs before filtering matters or assigning work.
 */
export function registerFirmTools(server: McpServer): void {
  registerTool(server, {
    name: "list-pipelines",
    description:
      "List the firm's pipelines with matter counts, estimated value, and stage references. " +
      "Use with list-stages to build a full pipeline board view.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/pipelines", args),
  });

  registerTool(server, {
    name: "list-stages",
    description:
      "List all pipeline stages. Each stage references its pipeline. To count matters per stage, " +
      "use list-matters with filter_by: 'stage_id'.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/stages", args),
  });

  registerTool(server, {
    name: "list-practice-areas",
    description: "List the firm's practice areas (id, name, color).",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/practice_areas", args),
  });

  registerTool(server, {
    name: "list-sources",
    description:
      "List marketing sources (where leads come from: Google, referrals, etc.). " +
      "For source ROI reporting, use list-matters with filter_by: 'source_id'.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/sources", args),
  });

  registerTool(server, {
    name: "list-sub-statuses",
    description:
      "List matter sub-statuses. Each belongs to a top-level status: pnc (potential new client), " +
      "hired, or lost. Use the IDs with create-matter / update-matter.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/sub_statuses", args),
  });

  registerTool(server, {
    name: "list-users",
    description: "List the firm's Lawmatics users (staff). Use the IDs for task/event assignment.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/users", args),
  });

  registerTool(server, {
    name: "get-current-user",
    description:
      "Get the user the access token belongs to. Also the cheapest way to verify the connection works.",
    schema: {},
    handler: () => lawmaticsGetOne("/users/me"),
  });
}
