import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsGetOne, lawmaticsPostRaw } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerFormTools(server: McpServer): void {
  registerTool(server, {
    name: "list-forms",
    description:
      "List the firm's custom forms (intake forms). Form IDs are UUIDs. " +
      "Use get-form to see a form's field structure.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/forms", args),
  });

  registerTool(server, {
    name: "get-form",
    description: "Get one custom form including its field layout (field IDs, labels, types, required flags).",
    schema: {
      form_uuid: z.string().describe("The form's UUID (from list-forms)."),
    },
    handler: ({ form_uuid }: { form_uuid: string }) =>
      lawmaticsGetOne(`/forms/${encodeURIComponent(form_uuid)}`, { fields: "all" }),
  });

  registerTool(server, {
    name: "get-form-entries",
    description: "List submissions for a custom form, each with label/value pairs and the matter it created.",
    schema: {
      form_uuid: z.string().describe("The form's UUID (from list-forms)."),
      page: z.coerce.number().int().min(1).optional(),
      fetch_all: z.boolean().optional().describe("Follow pagination (capped at 1,000 records)."),
    },
    handler: ({ form_uuid, ...args }: { form_uuid: string } & ListArgs) =>
      runList(`/forms/${encodeURIComponent(form_uuid)}/entries`, args),
  });

  registerTool(server, {
    name: "submit-form",
    write: true,
    description:
      "Submit an entry to a custom form — creates a matter/contact and fires the form's automations, " +
      "exactly like a website submission. Standard keys: first_name, last_name, email, phone. " +
      "Custom fields use the key form 'custom_field_<id>' (IDs from get-form or list-custom-fields). " +
      "utm_source/utm_campaign/utm_medium/utm_term are also accepted.",
    schema: {
      form_uuid: z.string().describe("The form's UUID (from list-forms)."),
      data: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .describe("Field values keyed by field ID, e.g. {\"first_name\": \"Jane\", \"custom_field_2263\": \"yes\"}."),
    },
    handler: async ({ form_uuid, data }: { form_uuid: string; data: Record<string, unknown> }) => {
      const res = await lawmaticsPostRaw(`/forms/${encodeURIComponent(form_uuid)}/submit`, data);
      return res ?? { submitted: true, form_uuid };
    },
  });
}
