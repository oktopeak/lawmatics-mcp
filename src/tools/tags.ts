import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lawmaticsPostRaw } from "../lawmatics-client.js";
import { listParamsSchema, registerTool, runList, type ListArgs } from "../tool-helpers.js";

const tagTargetSchema = {
  target_type: z
    .enum(["matter", "contact", "company", "task"])
    .describe("What kind of record to tag."),
  target_id: z.coerce.number().int().describe("The record's ID."),
  tags: z.array(z.string()).min(1).describe("Tag names. Nonexistent tags are created automatically on attach."),
};

type TagTargetArgs = { target_type: "matter" | "contact" | "company" | "task"; target_id: number; tags: string[] };

function tagBody({ target_type, target_id, tags }: TagTargetArgs): Record<string, unknown> {
  return { [`${target_type}_id`]: target_id, tags };
}

export function registerTagTools(server: McpServer): void {
  registerTool(server, {
    name: "list-tags",
    description: "List the firm's tags.",
    schema: listParamsSchema,
    handler: (args: ListArgs) => runList("/tags", args),
  });

  registerTool(server, {
    name: "attach-tags",
    write: true,
    description: "Attach tags to a matter, contact, company, or task. Tags that don't exist yet are created.",
    schema: tagTargetSchema,
    handler: async (args: TagTargetArgs) => {
      await lawmaticsPostRaw("/tags/attach", tagBody(args));
      return { attached: args.tags, [`${args.target_type}_id`]: args.target_id };
    },
  });

  registerTool(server, {
    name: "detach-tags",
    write: true,
    description: "Detach tags from a matter, contact, company, or task.",
    schema: tagTargetSchema,
    handler: async (args: TagTargetArgs) => {
      await lawmaticsPostRaw("/tags/detach", tagBody(args));
      return { detached: args.tags, [`${args.target_type}_id`]: args.target_id };
    },
  });
}
