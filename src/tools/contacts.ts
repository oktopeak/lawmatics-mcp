import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsGetOne, lawmaticsPost, lawmaticsPut } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

const noteSchema = z.object({
  name: z.string().describe("Note title."),
  body: z.string().describe("Note body text."),
});

export function registerContactTools(server: McpServer): void {
  registerTool(server, {
    name: "list-contacts",
    description:
      "List contacts (people) with optional filter, sort, and pagination. A contact is the person; " +
      "the matter (prospect) is the case/lead attached to them.",
    schema: listParamsSchema,
    handler: (args: ListArgs) =>
      runList("/contacts", args, { fields: "first_name,last_name,email,phone,created_at,updated_at" }),
  });

  registerTool(server, {
    name: "get-contact",
    description: "Get full details for a single contact by ID, including custom fields.",
    schema: {
      contact_id: z.string().describe("The Lawmatics contact ID."),
      fields: z.string().optional().describe("Comma-separated attributes, or 'all' (default: all)."),
    },
    handler: ({ contact_id, fields }: { contact_id: string; fields?: string }) =>
      lawmaticsGetOne(`/contacts/${encodeURIComponent(contact_id)}`, { fields: fields ?? "all" }),
  });

  registerTool(server, {
    name: "find-contact",
    description:
      "Find a single contact by exact email, phone, or name. Returns the best match or not_found. " +
      "For fuzzy searches use list-contacts with filter_with: 'ilike' and % wildcards.",
    schema: {
      by: z.enum(["email", "phone", "name"]).describe("Which finder to use."),
      value: z.string().describe("The email address, phone number, or full name to look up."),
    },
    handler: ({ by, value }: { by: "email" | "phone" | "name"; value: string }) =>
      lawmaticsGetOne(`/contacts/find_by_${by}/${encodeURIComponent(value)}`),
  });

  registerTool(server, {
    name: "create-contact",
    write: true,
    description: "Create a new contact (person) without a matter. To create a lead with a case, use create-matter.",
    schema: {
      first_name: z.string(),
      last_name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.array(noteSchema).optional().describe("Notes to create with the contact."),
    },
    handler: (args: Record<string, unknown>) => lawmaticsPost("/contacts", args),
  });

  registerTool(server, {
    name: "update-contact",
    write: true,
    description: "Update a contact. Only the provided fields change.",
    schema: {
      contact_id: z.string().describe("The contact ID to update."),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    },
    handler: ({ contact_id, ...body }: { contact_id: string } & Record<string, unknown>) =>
      lawmaticsPut(`/contacts/${encodeURIComponent(contact_id)}`, body),
  });
}
