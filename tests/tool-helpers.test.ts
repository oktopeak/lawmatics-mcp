import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerTool, runList } from "../src/tool-helpers.js";
import { __resetRateLimiter, LawmaticsApiError } from "../src/lawmatics-client.js";
import { CONTACT_LIST, createMockServer, jsonResponse, mockFetch, parseResult } from "./helpers.js";

beforeEach(() => {
  __resetRateLimiter();
  process.env.LAWMATICS_ACCESS_TOKEN = "test-token";
  delete process.env.LAWMATICS_READ_ONLY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LAWMATICS_READ_ONLY;
});

describe("registerTool", () => {
  it("wraps handler results as JSON text content", async () => {
    const mock = createMockServer();
    registerTool(mock.server, {
      name: "demo",
      description: "d",
      schema: { x: z.string() },
      handler: async (args) => ({ echoed: args.x }),
    });
    const result = await mock.call("demo", { x: "hi" });
    expect(parseResult(result)).toEqual({ echoed: "hi" });
    expect(result.isError).toBeUndefined();
  });

  it("returns not_found as data (not isError) on 404", async () => {
    const mock = createMockServer();
    registerTool(mock.server, {
      name: "demo404",
      description: "d",
      schema: {},
      handler: async () => {
        throw new LawmaticsApiError(404, "Not found: /prospects/9");
      },
    });
    const result = await mock.call("demo404");
    expect(result.isError).toBeUndefined();
    expect(parseResult(result)).toMatchObject({ not_found: true });
  });

  it("returns isError text for other failures", async () => {
    const mock = createMockServer();
    registerTool(mock.server, {
      name: "demoerr",
      description: "d",
      schema: {},
      handler: async () => {
        throw new LawmaticsApiError(422, "Bad filter");
      },
    });
    const result = await mock.call("demoerr");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Bad filter");
  });

  it("does not register write tools in read-only mode", () => {
    process.env.LAWMATICS_READ_ONLY = "1";
    const mock = createMockServer();
    registerTool(mock.server, { name: "read-thing", description: "d", schema: {}, handler: async () => ({}) });
    registerTool(mock.server, {
      name: "write-thing",
      description: "d",
      write: true,
      schema: {},
      handler: async () => ({}),
    });
    expect(mock.has("read-thing")).toBe(true);
    expect(mock.has("write-thing")).toBe(false);
  });
});

describe("runList", () => {
  it("rejects filter_by without filter_on with an actionable message", async () => {
    await expect(runList("/contacts", { filter_by: "email" })).rejects.toThrow(/filter_on/);
  });

  it("allows presence operators without filter_on", async () => {
    const fetchMock = mockFetch(jsonResponse(CONTACT_LIST));
    await runList("/contacts", { filter_by: "email", filter_with: "not_null" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("filter_by")).toBe("email");
    expect(url.searchParams.get("filter_with")).toBe("not_null");
  });

  it("rejects filter_on without filter_by", async () => {
    await expect(runList("/contacts", { filter_on: "x" })).rejects.toThrow(/filter_by/);
  });

  it("applies default fields only when the caller does not override", async () => {
    const fetchMock = mockFetch(jsonResponse(CONTACT_LIST), jsonResponse(CONTACT_LIST));
    await runList("/contacts", {}, { fields: "first_name,last_name" });
    await runList("/contacts", { fields: "all" }, { fields: "first_name,last_name" });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("fields")).toBe("first_name,last_name");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("fields")).toBe("all");
  });

  it("passes page and sort params through", async () => {
    const fetchMock = mockFetch(jsonResponse(CONTACT_LIST));
    await runList("/contacts", { page: 3, sort_by: "created_at", sort_order: "asc" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("sort_by")).toBe("created_at");
    expect(url.searchParams.get("sort_order")).toBe("asc");
  });
});
