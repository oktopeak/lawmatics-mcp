import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsPost, lawmaticsPut } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

export function registerTaskTools(server: McpServer): void {
  registerTool(server, {
    name: "list-tasks",
    description:
      "List tasks with optional filter, sort, and pagination. Useful filters: done (true/false), " +
      "due_date (with <, >= operators), priority, matter_id, contact_id.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/tasks", args),
  });

  registerTool(server, {
    name: "create-task",
    write: true,
    description: "Create a task, optionally attached to a matter/contact/company and assigned to users.",
    schema: {
      name: z.string().describe("Task name."),
      description: z.string().optional(),
      due_date: z.string().optional().describe("Due date, ISO 8601 (e.g. 2026-08-15 or 2026-08-15T17:00:00-07:00)."),
      user_ids: z.array(z.number().int()).optional().describe("User IDs to assign (from list-users)."),
      priority: z.enum(["high", "medium", "low"]).optional().describe("Default: low."),
      taskable_type: z
        .enum(["Prospect", "Contact", "Company", "Client"])
        .optional()
        .describe("What the task is attached to. Use 'Prospect' for a matter."),
      taskable_id: z.number().int().optional().describe("ID of the record the task is attached to."),
      assigned_by_id: z.number().int().optional(),
      done: z.boolean().optional(),
    },
    handler: (args: Record<string, unknown>) => lawmaticsPost("/tasks", args),
  });

  registerTool(server, {
    name: "update-task",
    write: true,
    description: "Update a task — e.g. mark it done, change the due date, or reassign it.",
    schema: {
      task_id: z.string().describe("The task ID to update."),
      name: z.string().optional(),
      description: z.string().optional(),
      due_date: z.string().optional().describe("ISO 8601 date or datetime."),
      done: z.boolean().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      user_ids: z.array(z.number().int()).optional(),
    },
    handler: ({ task_id, ...body }: { task_id: string } & Record<string, unknown>) =>
      lawmaticsPut(`/tasks/${encodeURIComponent(task_id)}`, body),
  });
}
