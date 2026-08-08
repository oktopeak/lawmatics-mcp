import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimiter,
  enforceRateLimit,
  flattenResource,
  LawmaticsApiError,
  lawmaticsGetAll,
  lawmaticsGetList,
  lawmaticsGetOne,
  lawmaticsPost,
  lawmaticsPut,
  MAX_FETCH_ALL_PAGES,
  parseErrorMessage,
} from "../src/lawmatics-client.js";
import { CONTACT_LIST, ERROR_422, jsonResponse, listEnvelope, mockFetch, mockFetchWith, PROSPECT_SINGLE } from "./helpers.js";

beforeEach(() => {
  __resetRateLimiter();
  process.env.LAWMATICS_ACCESS_TOKEN = "test-token";
  delete process.env.LAWMATICS_API_BASE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("flattenResource", () => {
  it("flattens id, type, and attributes; normalizes id to string", () => {
    const flat = flattenResource({ id: 42, type: "contact", attributes: { first_name: "A" } });
    expect(flat).toEqual({ id: "42", type: "contact", first_name: "A" });
  });

  it("simplifies relationships and drops null/empty ones", () => {
    const flat = flattenResource(PROSPECT_SINGLE.data as never);
    expect(flat.first_name).toBe("Tyrion");
    const related = flat.related as Record<string, unknown>;
    expect(related.source).toEqual({ id: "6", type: "source" });
    expect(related.tasks).toEqual([{ id: "51", type: "task" }]);
    expect(related).not.toHaveProperty("owned_by");
    expect(related).not.toHaveProperty("notes");
  });

  it("dedupes duplicated custom_fields entries (observed in official examples)", () => {
    const flat = flattenResource({
      id: "1",
      type: "contact",
      attributes: {
        custom_fields: [
          { id: 4788, name: "text", value: "a" },
          { id: 4788, name: "text", value: "a" },
          { id: 99, name: "other", value: "b" },
        ],
      },
    });
    expect(flat.custom_fields).toHaveLength(2);
  });
});

describe("parseErrorMessage", () => {
  it("parses the documented errors-array shape", () => {
    expect(parseErrorMessage(JSON.stringify(ERROR_422))).toBe(
      "Filter By Parameter Not Available: Cannot filter by bogus_field"
    );
  });

  it("joins multiple errors", () => {
    const body = JSON.stringify({ errors: [{ title: "A" }, { detail: "B" }] });
    expect(parseErrorMessage(body)).toBe("A; B");
  });

  it("falls back to raw body for non-JSON", () => {
    expect(parseErrorMessage("<html>gateway timeout</html>")).toContain("gateway timeout");
  });
});

describe("lawmaticsGetOne", () => {
  it("sends bearer auth and returns the flattened record", async () => {
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE));
    const record = await lawmaticsGetOne("/prospects/25", { fields: "all" });
    expect(record.id).toBe("25");
    expect(record.case_title).toBe("Drank bad wine");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/prospects/25?fields=all");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("throws a clear error when the token env var is missing", async () => {
    delete process.env.LAWMATICS_ACCESS_TOKEN;
    mockFetch();
    await expect(lawmaticsGetOne("/users/me")).rejects.toThrow(/LAWMATICS_ACCESS_TOKEN is not set/);
  });

  it("maps 401 to a no-refresh-possible explanation", async () => {
    mockFetch(jsonResponse({ errors: [] }, { status: 401 }));
    await expect(lawmaticsGetOne("/users/me")).rejects.toThrow(/Tokens never expire/);
  });

  it("throws LawmaticsApiError with status 404 on not found", async () => {
    mockFetch(jsonResponse("", { status: 404 }));
    const err = await lawmaticsGetOne("/prospects/999").catch((e) => e);
    expect(err).toBeInstanceOf(LawmaticsApiError);
    expect(err.status).toBe(404);
  });

  it("surfaces the API error detail on 422", async () => {
    mockFetch(jsonResponse(ERROR_422, { status: 422 }));
    await expect(lawmaticsGetOne("/prospects/1")).rejects.toThrow(/Filter By Parameter Not Available/);
  });

  it("respects LAWMATICS_API_BASE override and strips trailing slashes", async () => {
    process.env.LAWMATICS_API_BASE = "https://example.test/v1///";
    const fetchMock = mockFetch(jsonResponse(PROSPECT_SINGLE));
    await lawmaticsGetOne("/prospects/25");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/prospects/25");
  });

  it("refuses non-envelope responses instead of guessing", async () => {
    mockFetch(jsonResponse({ something: "else" }));
    await expect(lawmaticsGetOne("/users/me")).rejects.toThrow(/Expected a \{data: \.\.\.\} envelope/);
  });

  it("treats {data: null} as not found (404)", async () => {
    mockFetch(jsonResponse({ data: null }));
    const err = await lawmaticsGetOne("/prospects/find_by_email/x%40y.com").catch((e) => e);
    expect(err).toBeInstanceOf(LawmaticsApiError);
    expect(err.status).toBe(404);
  });

  it("attributes can never corrupt the normalized string id", () => {
    const flat = flattenResource({ id: "25", type: "prospect", attributes: { id: 999, first_name: "T" } } as never);
    expect(flat.id).toBe("25");
    expect(flat.first_name).toBe("T");
  });
});

describe("lawmaticsGetList", () => {
  it("returns flattened items with meta", async () => {
    mockFetch(jsonResponse(CONTACT_LIST));
    const { items, meta } = await lawmaticsGetList("/contacts", { page: 1 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "136", first_name: "Linda" });
    expect(meta).toEqual({ page: 1, total_pages: 1, total_entries: 2 });
  });

  it("fails loudly when data is not an array", async () => {
    mockFetch(jsonResponse({ data: { id: "1" } }));
    await expect(lawmaticsGetList("/contacts")).rejects.toThrow(/refusing to report an empty list/);
  });
});

describe("lawmaticsGetAll (pagination)", () => {
  it("follows page=N until total_pages and reports complete", async () => {
    const pages: Record<string, unknown> = {
      "1": listEnvelope(
        [{ id: "1", type: "contact", attributes: {} }],
        { total_pages: 3, total_entries: 3 }
      ),
      "2": listEnvelope(
        [{ id: "2", type: "contact", attributes: {} }],
        { total_pages: 3, total_entries: 3 }
      ),
      "3": listEnvelope(
        [{ id: "3", type: "contact", attributes: {} }],
        { total_pages: 3, total_entries: 3 }
      ),
    };
    const fetchMock = mockFetchWith((url) => {
      const page = new URL(url).searchParams.get("page") ?? "1";
      return jsonResponse(pages[page]);
    });

    const result = await lawmaticsGetAll("/contacts");
    expect(result.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(result.complete).toBe(true);
    expect(result.pages).toBe(3);
    expect(result.total_entries).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops at the safety cap and reports complete: false", async () => {
    mockFetchWith((url) => {
      const page = parseInt(new URL(url).searchParams.get("page") ?? "1", 10);
      return jsonResponse(
        listEnvelope(
          [{ id: String(page), type: "contact", attributes: {} }],
          { total_pages: MAX_FETCH_ALL_PAGES + 10, total_entries: (MAX_FETCH_ALL_PAGES + 10) * 25 }
        )
      );
    });

    const result = await lawmaticsGetAll("/contacts");
    expect(result.complete).toBe(false);
    expect(result.pages).toBe(MAX_FETCH_ALL_PAGES);
    expect(result.incompleteReason).toMatch(/Stopped after 40 pages/);
  });

  it("treats a short page without total_pages as the last page", async () => {
    mockFetch(jsonResponse({ data: [{ id: "1", type: "tag", attributes: {} }], meta: {}, links: {} }));
    const result = await lawmaticsGetAll("/tags");
    expect(result.complete).toBe(true);
    expect(result.pages).toBe(1);
  });

  it("resumes from startPage so truncated fetches can continue", async () => {
    const fetchMock = mockFetchWith((url) => {
      const page = new URL(url).searchParams.get("page");
      return jsonResponse(
        listEnvelope([{ id: page as string, type: "contact", attributes: {} }], { total_pages: 42, total_entries: 1050 })
      );
    });
    const result = await lawmaticsGetAll("/contacts", undefined, 41);
    expect(result.items.map((i) => i.id)).toEqual(["41", "42"]);
    expect(result.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("retry behavior", () => {
  it("retries 429 honoring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    mockFetch(
      jsonResponse("", { status: 429, headers: { "Retry-After": "1" } }),
      jsonResponse(PROSPECT_SINGLE)
    );

    const pending = lawmaticsGetOne("/prospects/25");
    await vi.advanceTimersByTimeAsync(1100);
    const record = await pending;
    expect(record.id).toBe("25");
  });

  it("gives up after 2 retries on persistent 429 (bounded stall)", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchWith(() => jsonResponse("", { status: 429, headers: { "Retry-After": "1" } }));

    const pending = lawmaticsGetOne("/prospects/25").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const err = await pending;
    expect(err).toBeInstanceOf(LawmaticsApiError);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/after 2 retries/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps a huge Retry-After at 60 seconds per wait", async () => {
    vi.useFakeTimers();
    mockFetch(
      jsonResponse("", { status: 429, headers: { "Retry-After": "3600" } }),
      jsonResponse(PROSPECT_SINGLE)
    );
    const pending = lawmaticsGetOne("/prospects/25");
    await vi.advanceTimersByTimeAsync(61_000);
    const record = await pending;
    expect(record.id).toBe("25");
  });
});

describe("rate limiter", () => {
  it("delays the request that exceeds the per-minute budget", async () => {
    vi.useFakeTimers();
    process.env.LAWMATICS_RATE_LIMIT_PER_MIN = "2";
    try {
      await enforceRateLimit();
      await enforceRateLimit();
      let third = false;
      const pending = enforceRateLimit().then(() => {
        third = true;
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(third).toBe(false);
      await vi.advanceTimersByTimeAsync(61_000);
      await pending;
      expect(third).toBe(true);
    } finally {
      process.env.LAWMATICS_RATE_LIMIT_PER_MIN = "100000";
    }
  });
});

describe("write requests", () => {
  it("POST sends a JSON body and returns the created record", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { id: "109", type: "note", attributes: { name: "New Note" } } }, { status: 201 }));
    const record = await lawmaticsPost("/notes", { name: "New Note", body: "x", notable_type: "Prospect", notable_id: 1 });
    expect(record).toMatchObject({ id: "109", name: "New Note" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).notable_type).toBe("Prospect");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("PUT returns the updated record", async () => {
    mockFetch(jsonResponse({ data: { id: "25", type: "prospect", attributes: { first_name: "Changed" } } }));
    const record = await lawmaticsPut("/prospects/25", { first_name: "Changed" });
    expect(record.first_name).toBe("Changed");
  });
});
