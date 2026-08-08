import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTaskTools } from "../../src/tools/tasks.js";
import { registerEventTools } from "../../src/tools/events.js";
import { registerNoteTools } from "../../src/tools/notes.js";
import { registerTagTools } from "../../src/tools/tags.js";
import { __resetRateLimiter } from "../../src/lawmatics-client.js";
import { createMockServer, jsonResponse, listEnvelope, mockFetch, parseResult } from "../helpers.js";

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
  registerTaskTools(mock.server);
  registerEventTools(mock.server);
  registerNoteTools(mock.server);
  registerTagTools(mock.server);
  return mock;
}

describe("tasks", () => {
  it("create-task POSTs documented fields", async () => {
    const mock = setup();
    const fetchMock = mockFetch(
      jsonResponse({ data: { id: "117", type: "task", attributes: { name: "Call client", done: false } } }, { status: 201 })
    );
    await mock.call("create-task", {
      name: "Call client",
      due_date: "2026-08-15",
      priority: "high",
      taskable_type: "Prospect",
      taskable_id: 25,
      user_ids: [2],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ name: "Call client", taskable_type: "Prospect", taskable_id: 25, user_ids: [2] });
  });

  it("update-task marks done via PUT", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "3", type: "task", attributes: { done: true } } }));
    const result = parseResult(await mock.call("update-task", { task_id: "3", done: true }));
    expect(result.done).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/tasks/3");
    expect(JSON.parse(init.body as string)).toEqual({ done: true });
  });
});

describe("events", () => {
  it("list-events returns flattened events (official example shape)", async () => {
    const mock = setup();
    mockFetch(
      jsonResponse(
        listEnvelope([
          {
            id: "5",
            type: "event",
            attributes: { name: "Initial Consultation", start_date: "2021-12-31T22:01:00.000-08:00", all_day: false },
            relationships: { eventable: { data: { id: "105", type: "prospect" } } },
          },
        ])
      )
    );
    const result = parseResult(await mock.call("list-events", {}));
    expect(result.items[0]).toMatchObject({ name: "Initial Consultation" });
    expect(result.items[0].related.eventable).toEqual({ id: "105", type: "prospect" });
  });

  it("create-event POSTs to /events", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "13918", type: "event", attributes: {} } }, { status: 201 }));
    await mock.call("create-event", {
      name: "New Appointment",
      start_date: "2026-08-15T15:00:00-07:00",
      end_date: "2026-08-15T15:30:00-07:00",
      eventable_type: "Prospect",
      eventable_id: 25,
      send_invites: false,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.send_invites).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.lawmatics.com/v1/events");
  });
});

describe("notes & activities", () => {
  it("create-note POSTs notable polymorphics", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "109", type: "note", attributes: { name: "New Note" } } }, { status: 201 }));
    await mock.call("create-note", { name: "New Note", body: "text", notable_type: "Prospect", notable_id: 25 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      name: "New Note",
      body: "text",
      notable_type: "Prospect",
      notable_id: 25,
    });
  });

  it("list-activities always sends the required filter", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse(listEnvelope([{ id: "1", type: "timeline_activity", attributes: { key: "note.create" } }])));
    await mock.call("list-activities", { filter_by: "matter_id", filter_on: "25" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/activities");
    expect(url.searchParams.get("filter_by")).toBe("matter_id");
    expect(url.searchParams.get("filter_on")).toBe("25");
  });
});

describe("tags", () => {
  it("attach-tags builds the documented body key from target_type", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "290", type: "prospect", attributes: {} } }));
    const result = parseResult(
      await mock.call("attach-tags", { target_type: "matter", target_id: 290, tags: ["Existing Tag", "New Tag"] })
    );
    expect(result).toEqual({ attached: ["Existing Tag", "New Tag"], matter_id: 290 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/v1/tags/attach");
    expect(JSON.parse(init.body as string)).toEqual({ matter_id: 290, tags: ["Existing Tag", "New Tag"] });
  });

  it("detach-tags uses contact_id for contacts", async () => {
    const mock = setup();
    const fetchMock = mockFetch(jsonResponse({ data: { id: "1", type: "contact", attributes: {} } }));
    await mock.call("detach-tags", { target_type: "contact", target_id: 7, tags: ["Old"] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ contact_id: 7, tags: ["Old"] });
  });

  it("write tools hidden in read-only mode", () => {
    process.env.LAWMATICS_READ_ONLY = "1";
    const mock = setup();
    for (const hidden of ["create-task", "update-task", "create-event", "create-note", "attach-tags", "detach-tags"]) {
      expect(mock.has(hidden), hidden).toBe(false);
    }
    for (const visible of ["list-tasks", "list-events", "list-notes", "list-activities", "list-tags"]) {
      expect(mock.has(visible), visible).toBe(true);
    }
  });
});
