import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsGetOne, lawmaticsPost, lawmaticsPut } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

/**
 * Lawmatics calls every matter a "prospect" in API paths regardless of
 * pipeline status (pnc / hired / lost). Tools use the product term "matter".
 */

const DEFAULT_LIST_FIELDS =
  "first_name,last_name,email,phone,status,sub_status,case_title,created_at,updated_at";

const noteSchema = z.object({
  name: z.string().describe("Note title."),
  body: z.string().describe("Note body text."),
});

export function registerMatterTools(server: McpServer): void {
  registerTool(server, {
    name: "list-matters",
    description:
      "List matters (leads/prospects/clients) with optional filter, sort, and pagination. " +
      "Matter status is 'pnc' (potential new client), 'hired', or 'lost'. " +
      "Useful filters: status, practice_area_id, stage_id, source_id, sub_status_id, created_at, " +
      "estimated_value_cents, actual_value_cents. For pipeline reporting, combine filter_by with " +
      "fields and fetch_all, then aggregate the result.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/prospects", args, { fields: DEFAULT_LIST_FIELDS }),
  });

  registerTool(server, {
    name: "get-matter",
    description:
      "Get full details for a single matter by ID, including custom fields and related records " +
      "(contact, stage, practice area, tasks, notes, events, invoices as {id, type} references).",
    schema: {
      matter_id: z.string().describe("The Lawmatics matter (prospect) ID."),
      fields: z.string().optional().describe("Comma-separated attributes, or 'all' (default: all)."),
    },
    handler: ({ matter_id, fields }: { matter_id: string; fields?: string }) =>
      lawmaticsGetOne(`/prospects/${encodeURIComponent(matter_id)}`, { fields: fields ?? "all" }),
  });

  registerTool(server, {
    name: "find-matter",
    description:
      "Find a single matter by exact email, phone, or name. Returns the best match or not_found. " +
      "For fuzzy or multi-result searches use list-matters with filter_with: 'ilike' and % wildcards.",
    schema: {
      by: z.enum(["email", "phone", "name"]).describe("Which finder to use."),
      value: z.string().describe("The email address, phone number, or full name to look up."),
    },
    handler: ({ by, value }: { by: "email" | "phone" | "name"; value: string }) =>
      lawmaticsGetOne(`/prospects/find_by_${by}/${encodeURIComponent(value)}`),
  });

  registerTool(server, {
    name: "create-matter",
    write: true,
    description:
      "Create a new matter (lead). By default this also creates a contact from first/last name. " +
      "Pass contact_id to attach an existing contact, or match_contact_by to reuse a contact matched " +
      "on email/name/phone (falls back to creating one). Pass company_id or company_name for a company " +
      "matter. Tags that don't exist yet are created automatically.",
    schema: {
      first_name: z.string().describe("Client first name."),
      last_name: z.string().describe("Client last name."),
      email: z.string().optional(),
      phone: z.string().optional(),
      case_title: z.string().optional(),
      case_blurb: z.string().optional().describe("Short case description."),
      practice_area_id: z.coerce.number().int().optional().describe("From list-practice-areas."),
      sub_status_id: z.coerce.number().int().optional().describe("From list-sub-statuses."),
      contact_id: z.coerce.number().int().optional().describe("Attach an existing contact. Overrides match_contact_by."),
      match_contact_by: z
        .enum(["email", "name", "phone"])
        .optional()
        .describe("Reuse an existing contact matched on this attribute instead of creating a duplicate."),
      company_id: z.coerce.number().int().optional().describe("Create as a company matter for this company."),
      company_name: z.string().optional().describe("Create as a company matter, matching the company by name."),
      notes: z.array(noteSchema).optional().describe("Notes to create with the matter."),
      tags: z.array(z.string()).optional().describe("Tag names to attach (auto-created if missing)."),
    },
    handler: (args: Record<string, unknown>) => lawmaticsPost("/prospects", args),
  });

  registerTool(server, {
    name: "update-matter",
    write: true,
    description:
      "Update a matter. Only the provided fields change. Note: the public API has no documented way " +
      "to move a matter between pipeline stages — sub_status_id is the closest control.",
    schema: {
      matter_id: z.string().describe("The matter (prospect) ID to update."),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      case_title: z.string().optional(),
      case_blurb: z.string().optional(),
      practice_area_id: z.coerce.number().int().optional(),
      sub_status_id: z.coerce.number().int().optional(),
      assigned_staff_ids: z.array(z.coerce.number().int()).optional().describe("User IDs from list-users."),
      notes: z.array(noteSchema).optional().describe("Additional notes to add."),
      tags: z.array(z.string()).optional(),
    },
    handler: ({ matter_id, ...body }: { matter_id: string } & Record<string, unknown>) =>
      lawmaticsPut(`/prospects/${encodeURIComponent(matter_id)}`, body),
  });
}
