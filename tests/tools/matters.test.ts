import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMatterTools } from "../../src/tools/matters.js";
import { __resetRateLimiter } from "../../src/lawmatics-client.js";
import {
  CONTACT_LIST,
  createMockServer,
  jsonResponse,
  listEnvelope,
  mockFetch,
  parseResult,
  PROSPECT_SINGLE,
} from "../helpers.js";

beforeEach(() => {
  __resetRateLimiter();
  process.env.LAWMATICS_ACCESS_TOKEN = "test-token";
  delete process.env.LAWMATICS_READ_ONLY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LAWMATICS_READ_ONLY;
});

function setup() {
  const mock = createMockServer();
  registerMatterTools(mock.server);
  return mock;
}

describe("list-matters", () => {
  it("hits /prospects with the curated default fields", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(listEnvelope([{ id: "1", type: "prospect", attributes: { first_name: "A" } }])));
    const result = parseResult(await mock.call("list-matters", {}));
    expect(result.items).toHaveLength(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/prospects");
    expect(url.searchParams.get("fields")).toContain("status");
  });

  it("passes a single filter through", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(listEnvelope([])));
    await mock.call("list-matters", { filter_by: "practice_area_id", filter_on: "3" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("filter_by")).toBe("practice_area_id");
    expect(url.searchParams.get("filter_on")).toBe("3");
  });
});

describe("get-matter", () => {
  it("requests fields=all by default and flattens the record", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE));
    const result = parseResult(await mock.call("get-matter", { matter_id: "25" }));
    expect(result).toMatchObject({ id: "25", first_name: "Tyrion", case_title: "Drank bad wine" });
    expect(result.related.stage).toEqual({ id: "2", type: "stage" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/prospects/25");
    expect(url.searchParams.get("fields")).toBe("all");
  });

  it("returns not_found data on 404", async () => {
    const mock = setup();
    mockFetch(jsonResponse("", { status: 404 }));
    const result = await mock.call("get-matter", { matter_id: "999999" });
    expect(result.isError).toBeUndefined();
    expect(parseResult(result).not_found).toBe(true);
  });
});

describe("find-matter", () => {
  it("URL-encodes the finder path segment (emails with + and dots)", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE));
    await mock.call("find-matter", { by: "email", value: "roey+api@lawmatics.com" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.lawmatics.com/v1/prospects/find_by_email/roey%2Bapi%40lawmatics.com"
    );
  });
});

describe("create-matter", () => {
  it("POSTs the given fields", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE, { status: 201 }));
    await mock.call("create-matter", {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      practice_area_id: 4,
      tags: ["API Lead"],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/prospects");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ first_name: "Jane", practice_area_id: 4, tags: ["API Lead"] });
  });

  it("is hidden in read-only mode", () => {
    process.env.LAWMATICS_READ_ONLY = "1";
    const mock = setup();
    expect(mock.has("create-matter")).toBe(false);
    expect(mock.has("update-matter")).toBe(false);
    expect(mock.has("list-matters")).toBe(true);
    expect(mock.has("get-matter")).toBe(true);
  });
});

describe("update-matter", () => {
  it("PUTs to the matter path without leaking matter_id into the body", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE));
    await mock.call("update-matter", { matter_id: "25", sub_status_id: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/prospects/25");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ sub_status_id: 7 });
    expect(body).not.toHaveProperty("matter_id");
  });
});

describe("errors", () => {
  it("surfaces API 422 details as isError", async () => {
    const mock = setup();
    mockFetch(
      jsonResponse(
        { errors: [{ status: 422, title: "Validation", detail: "first_name required" }] },
        { status: 422 }
      )
    );
    const result = await mock.call("list-matters", { filter_by: "status", filter_on: "pnc" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("first_name required");
  });

  it("catches contact list fixture sanity (fixture parity)", async () => {
    const mock = setup();
    mockFetch(jsonResponse(CONTACT_LIST));
    const result = parseResult(await mock.call("list-matters", {}));
    expect(result.meta.total_entries).toBe(2);
  });
});
