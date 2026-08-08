import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerContactTools } from "../../src/tools/contacts.js";
import { registerCompanyTools } from "../../src/tools/companies.js";
import { __resetRateLimiter } from "../../src/lawmatics-client.js";
import { CONTACT_LIST, createMockServer, jsonResponse, mockFetch, parseResult } from "../helpers.js";

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
  registerContactTools(mock.server);
  registerCompanyTools(mock.server);
  return mock;
}

describe("contacts", () => {
  it("list-contacts returns flattened contacts with meta", async () => {
    const mock = setup();
    mockFetch(jsonResponse(CONTACT_LIST));
    const result = parseResult(await mock.call("list-contacts", {}));
    expect(result.items[0]).toMatchObject({ id: "136", first_name: "Linda" });
    expect(result.meta.total_entries).toBe(2);
  });

  it("find-contact encodes the value into the path", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: CONTACT_LIST.data[0] }));
    await mock.call("find-contact", { by: "name", value: "Linda Baker" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.lawmatics.com/v1/contacts/find_by_name/Linda%20Baker");
  });

  it("create-contact POSTs to /contacts", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: CONTACT_LIST.data[0] }, { status: 201 }));
    await mock.call("create-contact", { first_name: "Linda", last_name: "Baker" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.lawmatics.com/v1/contacts");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("update-contact PUTs without contact_id in the body", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: CONTACT_LIST.data[0] }));
    await mock.call("update-contact", { contact_id: "136", email: "new@example.com" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/contacts/136");
    expect(JSON.parse(init.body as string)).toEqual({ email: "new@example.com" });
  });

  it("write tools hidden in read-only mode; reads stay", () => {
    process.env.LAWMATICS_READ_ONLY = "true";
    const mock = setup();
    expect(mock.has("create-contact")).toBe(false);
    expect(mock.has("update-contact")).toBe(false);
    expect(mock.has("list-contacts")).toBe(true);
    expect(mock.has("find-contact")).toBe(true);
  });
});

describe("companies", () => {
  it("get-company defaults to fields=all", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "2", type: "company", attributes: { name: "Acme" } } }));
    const result = parseResult(await mock.call("get-company", { company_id: "2" }));
    expect(result.name).toBe("Acme");
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("fields")).toBe("all");
  });

  it("find-company hits the finder path", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "2", type: "company", attributes: {} } }));
    await mock.call("find-company", { by: "email", value: "info@acme.com" });
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/companies/find_by_email/info%40acme.com");
  });
});
