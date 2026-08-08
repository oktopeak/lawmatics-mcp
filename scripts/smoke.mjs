// End-to-end smoke test: real SDK client <-> built server over stdio,
// against a local fake Lawmatics API. Run: node scripts/smoke.mjs
import http from "http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/v1/users/me")) {
      res.end(JSON.stringify({ data: { id: "17", type: "user", attributes: { name: "Roey", email: "r@l.com" } } }));
    } else if (req.url.startsWith("/v1/tags/attach")) {
      const parsed = JSON.parse(body);
      if (typeof parsed.matter_id !== "number") {
        res.statusCode = 422;
        res.end(JSON.stringify({ errors: [{ status: 422, title: "Bad", detail: "matter_id must be a number" }] }));
        return;
      }
      res.end(JSON.stringify({ data: { id: String(parsed.matter_id), type: "prospect", attributes: {} } }));
    } else if (req.url.startsWith("/v1/prospects?")) {
      res.end(
        JSON.stringify({
          data: [{ id: "25", type: "prospect", attributes: { first_name: "Tyrion", status: "pnc" } }],
          meta: { total_pages: 1, limit_per_page: 25, total_entries: 1 },
          links: {},
        })
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
});

await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${fake.address().port}/v1`;

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  env: { ...process.env, LAWMATICS_ACCESS_TOKEN: "smoke-token", LAWMATICS_API_BASE: apiBase, LAWMATICS_AUDIT_LOG: "0" },
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
};

const { tools } = await client.listTools();
if (tools.length < 30) fail(`expected 30+ tools, got ${tools.length}`);

const me = await client.callTool({ name: "get-current-user", arguments: {} });
if (me.isError || !me.content[0].text.includes("Roey")) fail(`get-current-user: ${me.content[0].text}`);

// The critical regression: a STRING id through real zod validation must coerce.
const tag = await client.callTool({
  name: "attach-tags",
  arguments: { target_type: "matter", target_id: "290", tags: ["Smoke"] },
});
if (tag.isError) fail(`attach-tags with string id: ${tag.content[0].text}`);

const list = await client.callTool({ name: "list-matters", arguments: { page: 1 } });
if (list.isError || !list.content[0].text.includes("Tyrion")) fail(`list-matters: ${list.content[0].text}`);

const res = await client.readResource({ uri: "lawmatics://auth-status" });
if (!res.contents[0].text.includes("token_configured")) fail("auth-status resource");

console.log(`SMOKE OK: ${tools.length} tools, string-id write coerced, list + resource verified.`);
await client.close();
fake.close();
process.exit(0);
