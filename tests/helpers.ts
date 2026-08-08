import { vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Tests must never write a real audit log or throttle.
process.env.LAWMATICS_AUDIT_LOG = "0";
process.env.LAWMATICS_ACCESS_TOKEN = process.env.LAWMATICS_ACCESS_TOKEN || "test-token";
process.env.LAWMATICS_RATE_LIMIT_PER_MIN = process.env.LAWMATICS_RATE_LIMIT_PER_MIN || "100000";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

export function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
    resource: () => undefined,
  } as unknown as McpServer;

  return {
    server,
    handlers,
    has: (name: string) => handlers.has(name),
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`Tool "${name}" not registered`);
      return h(args);
    },
  };
}

export function parseResult(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

export function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Install a fetch mock; returns the mock for call inspection. */
export function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Fetch mock driven by a routing function (for pagination loops etc.). */
export function mockFetchWith(router: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(router(url, init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// --- Fixtures taken from the official Lawmatics API docs example payloads ---

export function listEnvelope(
  resources: Array<{ id: string; type: string; attributes?: Record<string, unknown>; relationships?: unknown }>,
  meta?: { total_pages?: number; total_entries?: number }
) {
  return {
    data: resources,
    meta: { total_pages: 1, limit_per_page: 25, total_entries: resources.length, ...(meta ?? {}) },
    links: { self: "/v1/x?page=1" },
  };
}

export const PROSPECT_SINGLE = {
  data: {
    id: "25",
    type: "prospect",
    attributes: {
      first_name: "Tyrion",
      last_name: "Lannister",
      case_title: "Drank bad wine",
      status: "active",
      email: "tyrion@small.com",
      estimated_value_cents: 250000,
      custom_fields: [],
      created_at: "2018-03-07T13:51:38.789-08:00",
      updated_at: "2018-10-16T14:43:25.697-07:00",
    },
    relationships: {
      source: { data: { id: "6", type: "source" } },
      stage: { data: { id: "2", type: "stage" } },
      practice_area: { data: { id: "3", type: "practice_area" } },
      owned_by: { data: null },
      notes: { data: [] },
      tasks: { data: [{ id: "51", type: "task" }] },
    },
  },
};

export const CONTACT_LIST = listEnvelope(
  [
    {
      id: "136",
      type: "contact",
      attributes: { first_name: "Linda", last_name: "Baker", email: "Linda35@gmail.com" },
      relationships: {},
    },
    {
      id: "135",
      type: "contact",
      attributes: { first_name: "James", last_name: "Lee", email: "James34@gmail.com" },
      relationships: {},
    },
  ],
  { total_pages: 1, total_entries: 2 }
);

export const ERROR_422 = {
  errors: [{ status: 422, title: "Filter By Parameter Not Available", detail: "Cannot filter by bogus_field" }],
};
