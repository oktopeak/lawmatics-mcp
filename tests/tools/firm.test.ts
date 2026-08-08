import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerFirmTools } from "../../src/tools/firm.js";
import { __resetRateLimiter } from "../../src/lawmatics-client.js";
import { createMockServer, jsonResponse, listEnvelope, mockFetch, parseResult } from "../helpers.js";

beforeEach(() => {
  __resetRateLimiter();
  process.env.LAWMATICS_ACCESS_TOKEN = "test-token";
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const mock = createMockServer();
  registerFirmTools(mock.server);
  return mock;
}

const CASES: Array<[string, string]> = [
  ["list-pipelines", "/v1/pipelines"],
  ["list-stages", "/v1/stages"],
  ["list-practice-areas", "/v1/practice_areas"],
  ["list-sources", "/v1/sources"],
  ["list-sub-statuses", "/v1/sub_statuses"],
  ["list-users", "/v1/users"],
];

describe("firm reference tools", () => {
  for (const [tool, path] of CASES) {
    it(`${tool} hits ${path}`, async () => {
      const mock = setup();
      const fetchMock = mockFetch(jsonResponse(listEnvelope([{ id: "1", type: "x", attributes: { name: "N" } }])));
      const result = parseResult(await mock.call(tool, {}));
      expect(result.items[0].name).toBe("N");
      expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(path);
    });
  }

  it("get-current-user hits /users/me (official example shape)", async () => {
    const mock = setup();
    const fetchMock = mockFetch(
      jsonResponse({
        data: {
          id: "17",
          type: "user",
          attributes: { name: "Roey Chasman", email: "roey@lawmatics.com" },
          relationships: {},
        },
      })
    );
    const result = parseResult(await mock.call("get-current-user", {}));
    expect(result).toMatchObject({ id: "17", name: "Roey Chasman" });
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/v1/users/me");
  });

  it("pipelines example payload flattens with stage refs (official example shape)", async () => {
    const mock = setup();
    mockFetch(
      jsonResponse(
        listEnvelope([
          {
            id: "4",
            type: "pipeline",
            attributes: { name: "Intake", pipeline_type: "intake", matter_count: 173, estimated_value: "$0.22" },
            relationships: {
              stages: { data: [{ id: "6", type: "stage" }, { id: "7", type: "stage" }] },
              created_by: { data: { id: "3", type: "user" } },
            },
          },
        ])
      )
    );
    const result = parseResult(await mock.call("list-pipelines", {}));
    expect(result.items[0].related.stages).toHaveLength(2);
    expect(result.items[0].matter_count).toBe(173);
  });
});
