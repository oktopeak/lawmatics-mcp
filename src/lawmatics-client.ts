/**
 * Thin HTTP client for the Lawmatics REST API (https://docs.lawmatics.com).
 *
 * API shape notes that drive this module:
 * - Envelope is JSON:API-flavored: single = {data: {id, type, attributes, relationships}},
 *   list = {data: [...], meta: {total_pages, limit_per_page, total_entries}, links: {next?}}.
 * - IDs arrive as strings on resources but as numbers inside some nested objects
 *   (e.g. custom_fields entries) — normalize everything to strings.
 * - Pagination is `?page=N` with a fixed page size of 25. No per_page param exists.
 * - Access tokens never expire and there is no refresh token, so a 401 always means
 *   the token itself is wrong/revoked — never retry it.
 * - Documented rate limit conflicts between 50/min (API docs) and 150/min (help
 *   center). Default to the conservative 50/min; override with
 *   LAWMATICS_RATE_LIMIT_PER_MIN if your firm has the higher limit.
 */

export class LawmaticsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "LawmaticsApiError";
  }
}

export function getApiBase(): string {
  return (process.env.LAWMATICS_API_BASE ?? "https://api.lawmatics.com/v1").replace(/\/+$/, "");
}

function getAccessToken(): string {
  const token = process.env.LAWMATICS_ACCESS_TOKEN;
  if (!token) {
    throw new LawmaticsApiError(
      401,
      "LAWMATICS_ACCESS_TOKEN is not set. Run `npx @oktopeak/lawmatics-mcp auth` to obtain a token " +
        "(Lawmatics tokens never expire), then add it to your MCP server config."
    );
  }
  return token.trim();
}

/**
 * Lawmatics error bodies are {"errors": [{"status": 422, "title": "...", "detail": "..."}]}.
 * Fall back to common alternates, then the raw body.
 */
export function parseErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as unknown;
    if (typeof j === "object" && j !== null) {
      const o = j as Record<string, unknown>;
      if (Array.isArray(o["errors"])) {
        const parts = (o["errors"] as unknown[]).map((e) => {
          if (typeof e === "object" && e !== null) {
            const err = e as Record<string, unknown>;
            const title = typeof err["title"] === "string" ? err["title"] : "";
            const detail = typeof err["detail"] === "string" ? err["detail"] : "";
            if (title && detail) return `${title}: ${detail}`;
            return title || detail || JSON.stringify(err);
          }
          return String(e);
        });
        if (parts.length) return parts.join("; ");
      }
      if (typeof o["error"] === "string") return o["error"];
      if (typeof o["message"] === "string") return o["message"];
    }
  } catch {
    // fall through to raw body
  }
  return body.slice(0, 300) || "Unknown error";
}

// ---------------------------------------------------------------------------
// Rate limiting — sliding one-minute window, conservative 50 req/min default.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
let requestTimestamps: number[] = [];

function getRateLimit(): number {
  const raw = process.env.LAWMATICS_RATE_LIMIT_PER_MIN;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export async function enforceRateLimit(): Promise<void> {
  const limit = getRateLimit();
  for (;;) {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter((t) => now - t < WINDOW_MS);
    if (requestTimestamps.length < limit) {
      requestTimestamps.push(now);
      return;
    }
    const waitMs = requestTimestamps[0] + WINDOW_MS - now + 50;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** Test hook. */
export function __resetRateLimiter(): void {
  requestTimestamps = [];
}

// ---------------------------------------------------------------------------
// Envelope flattening
// ---------------------------------------------------------------------------

type JsonApiRef = { id: string | number; type?: string };
type JsonApiResource = {
  id: string | number;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: JsonApiRef | JsonApiRef[] | null } | undefined>;
};

export type FlatRecord = Record<string, unknown> & { id: string; type?: string };

function simplifyRef(ref: JsonApiRef): { id: string; type?: string } {
  return { id: String(ref.id), ...(ref.type ? { type: ref.type } : {}) };
}

/**
 * Custom-field arrays in real responses sometimes contain the same field twice
 * (observed in the official example payloads). Keep the last occurrence.
 */
function dedupeCustomFields(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const byId = new Map<string, unknown>();
  const noId: unknown[] = [];
  for (const item of value) {
    if (typeof item === "object" && item !== null && "id" in item) {
      byId.set(String((item as { id: unknown }).id), item);
    } else {
      noId.push(item);
    }
  }
  return [...byId.values(), ...noId];
}

/**
 * Collapse {id, type, attributes, relationships} into one flat object so tool
 * output stays compact. Empty/null relationships are dropped; the rest are
 * simplified to {id, type} refs under a `related` key (the API never expands
 * them — fetch the referenced record for details).
 */
export function flattenResource(resource: JsonApiResource): FlatRecord {
  const attributes = { ...(resource.attributes ?? {}) };
  if ("custom_fields" in attributes) {
    attributes["custom_fields"] = dedupeCustomFields(attributes["custom_fields"]);
  }

  const related: Record<string, unknown> = {};
  for (const [key, rel] of Object.entries(resource.relationships ?? {})) {
    const data = rel?.data;
    if (data === null || data === undefined) continue;
    if (Array.isArray(data)) {
      if (data.length === 0) continue;
      related[key] = data.map(simplifyRef);
    } else {
      related[key] = simplifyRef(data);
    }
  }

  // Attributes may legitimately contain their own `type` (e.g. custom_field
  // definitions carry the owner type) — let those win over the JSON:API type.
  // The normalized string `id` is assigned LAST so no attribute can ever
  // corrupt it (nested objects are exactly where the API leaks numeric ids).
  const flat: FlatRecord = {
    ...(resource.type ? { type: resource.type } : {}),
    ...attributes,
    ...(Object.keys(related).length ? { related } : {}),
    id: String(resource.id),
  };
  return flat;
}

export type ListMeta = {
  page: number;
  total_pages?: number;
  total_entries?: number;
};

export type ListResult = { items: FlatRecord[]; meta: ListMeta };

export type FetchAllResult = {
  items: FlatRecord[];
  /** False when the list is known to be missing records. Never report a partial list as complete. */
  complete: boolean;
  pages: number;
  total_entries?: number;
  incompleteReason?: string;
};

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export type QueryParams = Record<string, string | number | boolean | undefined>;

async function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params?: QueryParams,
  body?: unknown,
  retryCount = 0
): Promise<unknown> {
  await enforceRateLimit();

  const token = getAccessToken();
  const url = new URL(`${getApiBase()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    // Lawmatics sends Retry-After: 60, so each retry is expensive. Cap at 2
    // retries with waits capped at 60s so a tool call can never hang for
    // multiple minutes past the MCP client's own timeout.
    if (retryCount >= 2) {
      throw new LawmaticsApiError(
        429,
        "Rate limited by Lawmatics (429) after 2 retries. The per-firm limit is shared across ALL " +
          "integrations — wait a minute and retry, or narrow the query."
      );
    }
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "", 10);
    const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000, 60_000);
    console.error(`[lawmatics-mcp] 429 rate limited — waiting ${waitMs}ms (attempt ${retryCount + 1}/2)`);
    await new Promise((r) => setTimeout(r, waitMs));
    return request(method, path, params, body, retryCount + 1);
  }

  if (res.status === 401) {
    // Lawmatics tokens never expire, so a 401 is always a bad/revoked token — not retryable.
    throw new LawmaticsApiError(
      401,
      "Lawmatics rejected the access token (401). Tokens never expire, so the token is either wrong, " +
        "revoked, or from a deleted developer app. Re-run `npx @oktopeak/lawmatics-mcp auth` and update " +
        "LAWMATICS_ACCESS_TOKEN."
    );
  }

  if (res.status === 404) throw new LawmaticsApiError(404, `Not found: ${path}`);
  if (res.status === 204) return null;

  const text = await res.text().catch(() => "");
  if (!res.ok) throw new LawmaticsApiError(res.status, parseErrorMessage(text));

  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LawmaticsApiError(
      res.status,
      `Lawmatics returned a non-JSON response for ${path}: ${text.slice(0, 200)}`
    );
  }
}

function expectEnvelope(body: unknown, path: string): { data: unknown; meta?: unknown } {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new LawmaticsApiError(
      200,
      `Expected a {data: ...} envelope from ${path} but got ${body === null ? "null" : typeof body}. ` +
        "The Lawmatics response format may have changed; refusing to guess."
    );
  }
  return body as { data: unknown; meta?: unknown };
}

/** GET a single-resource endpoint and return the flattened record. */
export async function lawmaticsGetOne(path: string, params?: QueryParams): Promise<FlatRecord> {
  const envelope = expectEnvelope(await request("GET", path, params), path);
  if (envelope.data === null) {
    // Some APIs signal "no match" as {data: null} instead of 404 — treat it the same.
    throw new LawmaticsApiError(404, `Not found: ${path} (empty data in response)`);
  }
  if (typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw new LawmaticsApiError(
      200,
      `Expected a single resource from ${path} but got ${Array.isArray(envelope.data) ? "an array" : typeof envelope.data}.`
    );
  }
  return flattenResource(envelope.data as JsonApiResource);
}

/** GET one page of a list endpoint. */
export async function lawmaticsGetList(path: string, params?: QueryParams): Promise<ListResult> {
  const envelope = expectEnvelope(await request("GET", path, params), path);
  if (!Array.isArray(envelope.data)) {
    // A list endpoint that stops returning arrays must fail loudly: an empty
    // fallback would look exactly like a real "no results".
    throw new LawmaticsApiError(
      200,
      `Expected an array in the data field from ${path} but got ${typeof envelope.data}. ` +
        "The Lawmatics response format may have changed; refusing to report an empty list."
    );
  }
  const meta = (envelope.meta ?? {}) as Record<string, unknown>;
  const pageParam = params?.["page"];
  return {
    items: (envelope.data as JsonApiResource[]).map(flattenResource),
    meta: {
      page: typeof pageParam === "number" ? pageParam : 1,
      ...(typeof meta["total_pages"] === "number" ? { total_pages: meta["total_pages"] as number } : {}),
      ...(typeof meta["total_entries"] === "number" ? { total_entries: meta["total_entries"] as number } : {}),
    },
  };
}

/**
 * Hard cap for fetch_all so a runaway loop can't spin forever or flood the
 * context window: 40 pages × 25 records = 1,000 records.
 */
export const MAX_FETCH_ALL_PAGES = 40;

/**
 * Follow ?page=N pagination to the end (or the safety cap), starting at
 * `startPage` so a truncated fetch can be resumed. The completeness flag
 * travels with the result — a truncated list must never look whole.
 */
export async function lawmaticsGetAll(path: string, params?: QueryParams, startPage = 1): Promise<FetchAllResult> {
  const items: FlatRecord[] = [];
  let page = Math.max(1, startPage);
  let pages = 0;
  let totalPages: number | undefined;
  let totalEntries: number | undefined;

  for (;;) {
    const result = await lawmaticsGetList(path, { ...params, page });
    items.push(...result.items);
    pages++;
    totalPages = result.meta.total_pages ?? totalPages;
    totalEntries = result.meta.total_entries ?? totalEntries;

    const morePages =
      totalPages !== undefined ? page < totalPages : result.items.length > 0 && result.items.length >= 25;
    if (!morePages) {
      return { items, complete: true, pages, ...(totalEntries !== undefined ? { total_entries: totalEntries } : {}) };
    }
    if (pages >= MAX_FETCH_ALL_PAGES) {
      return {
        items,
        complete: false,
        pages,
        ...(totalEntries !== undefined ? { total_entries: totalEntries } : {}),
        incompleteReason:
          `Stopped after ${MAX_FETCH_ALL_PAGES} pages (${items.length} records) with more available` +
          (totalPages ? ` (${totalPages} pages total).` : ".") +
          ` To resume, call again with fetch_all: true and page: ${page + 1} — or narrow the query with a filter.`,
      };
    }
    page++;
  }
}

/** POST that returns a resource envelope (create endpoints). */
export async function lawmaticsPost(path: string, body: unknown, params?: QueryParams): Promise<FlatRecord> {
  const envelope = expectEnvelope(await request("POST", path, params, body), path);
  if (typeof envelope.data !== "object" || envelope.data === null || Array.isArray(envelope.data)) {
    throw new LawmaticsApiError(200, `Expected a single resource from POST ${path}.`);
  }
  return flattenResource(envelope.data as JsonApiResource);
}

/** POST where the response body shape is not a resource envelope (or may be empty). */
export async function lawmaticsPostRaw(path: string, body: unknown, params?: QueryParams): Promise<unknown> {
  return request("POST", path, params, body);
}

export async function lawmaticsPut(path: string, body: unknown, params?: QueryParams): Promise<FlatRecord> {
  const envelope = expectEnvelope(await request("PUT", path, params, body), path);
  if (typeof envelope.data !== "object" || envelope.data === null || Array.isArray(envelope.data)) {
    throw new LawmaticsApiError(200, `Expected a single resource from PUT ${path}.`);
  }
  return flattenResource(envelope.data as JsonApiResource);
}

export async function lawmaticsDelete(path: string, params?: QueryParams): Promise<void> {
  await request("DELETE", path, params);
}
