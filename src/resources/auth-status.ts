import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApiBase } from "../lawmatics-client.js";
import { isReadOnly } from "../tool-helpers.js";

export function registerAuthStatusResource(server: McpServer): void {
  server.resource("auth-status", "lawmatics://auth-status", async () => {
    const hasToken = Boolean(process.env.LAWMATICS_ACCESS_TOKEN);
    const status = {
      token_configured: hasToken,
      api_base: getApiBase(),
      read_only_mode: isReadOnly(),
      guidance: hasToken
        ? "Token is configured. Call the get-current-user tool to verify it works."
        : "LAWMATICS_ACCESS_TOKEN is not set. Run `npx @oktopeak/lawmatics-mcp auth` to obtain one " +
          "(requires a Lawmatics developer app — ask Lawmatics support to enable Developer Settings), " +
          "then add the token to this server's env config.",
    };
    return {
      contents: [
        { uri: "lawmatics://auth-status", mimeType: "application/json", text: JSON.stringify(status, null, 2) },
      ],
    };
  });
}
