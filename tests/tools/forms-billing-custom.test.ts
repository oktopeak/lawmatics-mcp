import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFormTools } from "../../src/tools/forms.js";
import { registerBillingTools } from "../../src/tools/billing.js";
import { registerCustomFieldTools } from "../../src/tools/custom-fields.js";
import { __resetRateLimiter } from "../../src/lawmatics-client.js";
import { createMockServer, jsonResponse, listEnvelope, mockFetch, parseResult } from "../helpers.js";

beforeEach(() => {
  __resetRateLimiter();
  process.env.LAWMATICS_ACCESS_TOKEN = "test-token";
  delete process.env.LAWMATICS_READ_ONLY;
  delete process.env.LAWMATICS_EXPERIMENTAL_TOOLS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LAWMATICS_EXPERIMENTAL_TOOLS;
});

function setup() {
  const mock = createMockServer();
  registerFormTools(mock.server);
  registerBillingTools(mock.server);
  registerCustomFieldTools(mock.server);
  return mock;
}

describe("forms", () => {
  it("get-form-entries hits the nested entries path with the uuid encoded", async () => {
    const mock = setup();
    const fetchMock = mockFetch(
      jsonResponse(
        listEnvelope([
          {
            id: "91",
            type: "custom_form_entry",
            attributes: { body: [{ label: "First name", value: "Bob" }] },
            relationships: { contactable: { data: { id: "41869", type: "prospect" } } },
          },
        ])
      )
    );
    const result = parseResult(await mock.call("get-form-entries", { form_uuid: "ad79c099-6c37-47d0-9452-cdbeb297559f" }));
    expect(result.items[0].related.contactable.id).toBe("41869");
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(
      "/v1/forms/ad79c099-6c37-47d0-9452-cdbeb297559f/entries"
    );
  });

  it("submit-form POSTs the data payload as-is", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ success: true }));
    const result = parseResult(
      await mock.call("submit-form", {
        form_uuid: "abc-123",
        data: { first_name: "Jane", custom_field_2263: "yes" },
      })
    );
    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/forms/abc-123/submit");
    expect(JSON.parse(init.body as string)).toEqual({ first_name: "Jane", custom_field_2263: "yes" });
  });

  it("submit-form returns a fallback object when the API responds with no body", async () => {
    const mock = setup();
    mockFetch(new Response(null, { status: 204 }));
    const result = parseResult(await mock.call("submit-form", { form_uuid: "abc-123", data: { first_name: "J" } }));
    expect(result).toEqual({ submitted: true, form_uuid: "abc-123" });
  });
});

describe("billing", () => {
  it("list-invoices flattens cents fields (official example shape)", async () => {
    const mock = setup();
    mockFetch(
      jsonResponse(
        listEnvelope([
          {
            id: "1",
            type: "invoice",
            attributes: { number: 1, status: "sent", amount_cents: 0, outstanding_amount_cents: 0 },
            relationships: { prospect: { data: { id: "101", type: "prospect" } } },
          },
        ])
      )
    );
    const result = parseResult(await mock.call("list-invoices", {}));
    expect(result.items[0]).toMatchObject({ status: "sent", amount_cents: 0 });
    expect(result.items[0].related.prospect.id).toBe("101");
  });
});

describe("custom fields", () => {
  it("list-custom-fields defaults to fields=all (needed for list_options)", async () => {
    const mock = setup();
    const fetchMock = mockFetch(
      jsonResponse(
        listEnvelope([
          {
            id: "2",
            type: "custom_field",
            attributes: {
              name: "Status",
              field_type: "list",
              type: "Prospect",
              list_options: [{ id: 1, name: "Open" }],
            },
          },
        ])
      )
    );
    const result = parseResult(await mock.call("list-custom-fields", {}));
    expect(result.items[0].list_options).toEqual([{ id: 1, name: "Open" }]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("fields")).toBe("all");
  });

  it("set-matter-custom-fields is absent unless LAWMATICS_EXPERIMENTAL_TOOLS=1", () => {
    const mock = setup();
    expect(mock.has("set-matter-custom-fields")).toBe(false);
  });

  it("set-matter-custom-fields registers with the flag and PUTs the documented shape", async () => {
    process.env.LAWMATICS_EXPERIMENTAL_TOOLS = "1";
    const mock = setup();
    expect(mock.has("set-matter-custom-fields")).toBe(true);

    const fetchMock = mockFetch(jsonResponse({ data: { id: "25", type: "prospect", attributes: {} } }));
    await mock.call("set-matter-custom-fields", {
      matter_id: "25",
      custom_fields: [{ id: 6434, value: "New Value" }, { id: 6470, value: null }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/prospects/25");
    expect(JSON.parse(init.body as string)).toEqual({
      custom_fields: [{ id: 6434, value: "New Value" }, { id: 6470, value: null }],
    });
  });

  it("experimental write tool still respects read-only mode", () => {
    process.env.LAWMATICS_EXPERIMENTAL_TOOLS = "1";
    process.env.LAWMATICS_READ_ONLY = "1";
    const mock = setup();
    expect(mock.has("set-matter-custom-fields")).toBe(false);
    expect(mock.has("submit-form")).toBe(false);
    expect(mock.has("list-custom-fields")).toBe(true);
  });
});
