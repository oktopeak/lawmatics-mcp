import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsPost } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerNoteTools(server: McpServer): void {
  registerTool(server, {
    name: "list-notes",
    description:
      "List notes with optional filter, sort, and pagination. To get one matter's notes, " +
      "use filter_by: 'matter_id' with the matter ID as filter_on.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/notes", args),
  });

  registerTool(server, {
    name: "create-note",
    write: true,
    description: "Create a note on a matter, contact, or company.",
    schema: {
      name: z.string().describe("Note title."),
      body: z.string().describe("Note body text."),
      notable_type: z
        .enum(["Prospect", "Contact", "Company"])
        .describe("What the note is attached to. Use 'Prospect' for a matter."),
      notable_id: z.number().int().describe("ID of the record the note is attached to."),
    },
    handler: (args: Record<string, unknown>) => lawmaticsPost("/notes", args),
  });

  registerTool(server, {
    name: "list-activities",
    description:
      "List timeline activities (audit trail of everything that happened: notes, emails, stage moves...). " +
      "The Lawmatics API REQUIRES a filter here — pass filter_by ('matter_id' or 'contact_id') and filter_on.",
    schema: {
      filter_by: z.enum(["matter_id", "contact_id"]).describe("Required by the API."),
      filter_on: z.string().describe("The matter or contact ID."),
      page: z.number().int().min(1).optional(),
      fetch_all: z.boolean().optional().describe("Follow pagination (capped at 1,000 records)."),
    },
    handler: (args: { filter_by: "matter_id" | "contact_id"; filter_on: string; page?: number; fetch_all?: boolean }) =>
      runList("/activities", args),
  });
}
