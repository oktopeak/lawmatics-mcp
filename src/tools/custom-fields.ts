import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsPut } from "../lawmatics-client.js";
import { experimentalEnabled, listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerCustomFieldTools(server: McpServer): void {
  registerTool(server, {
    name: "list-custom-fields",
    description:
      "List the firm's custom field definitions (id, name, field_type, owner type, list options). " +
      "Read a record's custom field VALUES by adding 'custom_fields' to the fields parameter of " +
      "get-matter / get-contact / list-matters.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/custom_fields", args, { fields: "all" }),
  });

  // The write shape for custom field values is under-documented in the official
  // API docs (the update-matter doc describes the behavior but shows no example
  // body). This tool uses the documented description ("Passing Custom Field id
  // and value") and ships behind LAWMATICS_EXPERIMENTAL_TOOLS until a live
  // account confirms it. Bug reports welcome — that's why it's open source.
  if (experimentalEnabled()) {
    registerTool(server, {
      name: "set-matter-custom-fields",
      write: true,
      description:
        "EXPERIMENTAL (unverified against a live account — enable via LAWMATICS_EXPERIMENTAL_TOOLS=1): " +
        "set custom field values on a matter. Pass the custom field ID (from list-custom-fields) and the " +
        "new value; null clears a value. For list fields, pass the option ID.",
      schema: {
        matter_id: z.string().describe("The matter (prospect) ID."),
        custom_fields: z
          .array(
            z.object({
              id: z.number().int().describe("Custom field ID from list-custom-fields."),
              value: z
                .union([z.string(), z.number(), z.boolean(), z.null()])
                .describe("New value. null clears the field. For list fields use the option ID."),
            })
          )
          .min(1),
      },
      handler: ({ matter_id, custom_fields }: { matter_id: string; custom_fields: unknown }) =>
        lawmaticsPut(`/prospects/${encodeURIComponent(matter_id)}`, { custom_fields }),
    });
  }
}
