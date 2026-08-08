#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { registerMatterTools } from "./tools/matters.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerCompanyTools } from "./tools/companies.js";
import { registerFirmTools } from "./tools/firm.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerEventTools } from "./tools/events.js";
import { registerNoteTools } from "./tools/notes.js";
import { registerTagTools } from "./tools/tags.js";
import { registerCustomFieldTools } from "./tools/custom-fields.js";
import { registerFormTools } from "./tools/forms.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerAuthStatusResource } from "./resources/auth-status.js";
import { isReadOnly } from "./tool-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

// `npx @oktopeak/lawmatics-mcp auth` runs the one-time OAuth flow instead of the server.
if (process.argv[2] === "auth") {
  const { runAuthFlow } = await import("./auth.js");
  try {
    await runAuthFlow();
  } catch (err) {
    console.error(`[lawmatics-mcp] Auth failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
} else {
  if (!process.env.LAWMATICS_ACCESS_TOKEN) {
    console.error("[lawmatics-mcp] WARNING: LAWMATICS_ACCESS_TOKEN is not set.");
    console.error(
      "[lawmatics-mcp] Run `npx @oktopeak/lawmatics-mcp auth` to obtain a token (it never expires),"
    );
    console.error("[lawmatics-mcp] then add it to this server's env config. Starting anyway so auth-status can guide you.");
  }

  const _require = createRequire(import.meta.url);
  const { version } = _require("../package.json") as { version: string };

  const server = new McpServer({ name: "lawmatics-mcp", version });

  registerMatterTools(server);
  registerContactTools(server);
  registerCompanyTools(server);
  registerFirmTools(server);
  registerTaskTools(server);
  registerEventTools(server);
  registerNoteTools(server);
  registerTagTools(server);
  registerCustomFieldTools(server);
  registerFormTools(server);
  registerBillingTools(server);
  registerAuthStatusResource(server);

  if (isReadOnly()) {
    console.error("[lawmatics-mcp] Read-only mode: write tools are disabled (LAWMATICS_READ_ONLY is set).");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lawmatics-mcp] Server running on stdio. Ready for connections.");
}
