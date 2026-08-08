import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsGetOne } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerCompanyTools(server: McpServer): void {
  registerTool(server, {
    name: "list-companies",
    description: "List companies with optional filter, sort, and pagination.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/companies", args, { fields: "name,email,phone,created_at,updated_at" }),
  });

  registerTool(server, {
    name: "get-company",
    description: "Get full details for a single company by ID.",
    schema: {
      company_id: z.string().describe("The Lawmatics company ID."),
      fields: z.string().optional().describe("Comma-separated attributes, or 'all' (default: all)."),
    },
    handler: ({ company_id, fields }: { company_id: string; fields?: string }) =>
      lawmaticsGetOne(`/companies/${encodeURIComponent(company_id)}`, { fields: fields ?? "all" }),
  });

  registerTool(server, {
    name: "find-company",
    description: "Find a single company by exact email, phone, or name. Returns the best match or not_found.",
    schema: {
      by: z.enum(["email", "phone", "name"]).describe("Which finder to use."),
      value: z.string().describe("The email address, phone number, or company name to look up."),
    },
    handler: ({ by, value }: { by: "email" | "phone" | "name"; value: string }) =>
      lawmaticsGetOne(`/companies/find_by_${by}/${encodeURIComponent(value)}`),
  });
}
