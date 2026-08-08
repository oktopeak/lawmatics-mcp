import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsPost } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerEventTools(server: McpServer): void {
  registerTool(server, {
    name: "list-events",
    description:
      "List events (appointments) with optional filter, sort, and pagination. " +
      "For a date range, filter_by: 'start_date' with filter_with: '>=' (one filter per request; " +
      "sort by start_date and paginate for windows).",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/events", args),
  });

  registerTool(server, {
    name: "create-event",
    write: true,
    description:
      "Create an event (appointment), optionally attached to a matter or contact and with user hosts. " +
      "Set send_invites: false to avoid emailing attendees.",
    schema: {
      name: z.string().describe("Event name, e.g. 'Initial Consultation'."),
      description: z.string().optional(),
      start_date: z.string().describe("Start, ISO 8601 with offset, e.g. 2026-08-15T15:00:00-07:00."),
      end_date: z.string().describe("End, ISO 8601 with offset."),
      user_ids: z.array(z.number().int()).optional().describe("Host user IDs (from list-users)."),
      all_day: z.boolean().optional(),
      eventable_type: z
        .enum(["Prospect", "Contact", "Client"])
        .optional()
        .describe("What the event is attached to. Use 'Prospect' for a matter."),
      eventable_id: z.number().int().optional(),
      event_type_id: z.number().int().optional(),
      location_id: z.number().int().optional(),
      reminder_delay_length: z.number().int().optional(),
      reminder_type: z.enum(["minutes", "hours", "days", "weeks", "months"]).optional(),
      send_invites: z.boolean().optional().describe("Default true — Lawmatics emails invites unless set to false."),
      time_zone: z.string().optional().describe("IANA time zone, e.g. America/New_York."),
    },
    handler: (args: Record<string, unknown>) => lawmaticsPost("/events", args),
  });
}
