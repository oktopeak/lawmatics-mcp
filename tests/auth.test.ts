import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCodeForToken, waitForCallback } from "../src/auth.js";
import { jsonResponse, mockFetch } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("buildAuthorizeUrl", () => {
  it("builds the documented authorize URL", () => {
    const url = new URL(buildAuthorizeUrl("my-client", "http://localhost:5678/callback", "st4te"));
    expect(url.origin + url.pathname).toBe("https://app.lawmatics.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("my-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5678/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
  });
});

describe("exchangeCodeForToken", () => {
  it("POSTs the documented token request and returns access_token", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ token_type: "bearer", access_token: "WjR8HLdo847Z8kdfUtewJpCvkRX4JYLCIF2dUUul", created_at: 1539723267 })
    );
    const token = await exchangeCodeForToken("id", "secret", "auth-code", "http://localhost:5678/callback");
    expect(token).toBe("WjR8HLdo847Z8kdfUtewJpCvkRX4JYLCIF2dUUul");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lawmatics.com/oauth/token");
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: "id",
      client_secret: "secret",
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "http://localhost:5678/callback",
    });
  });

  it("throws with status and body on failure", async () => {
    mockFetch(jsonResponse({ error: "invalid_grant" }, { status: 401 }));
    await expect(exchangeCodeForToken("id", "secret", "bad", "r")).rejects.toThrow(/HTTP 401/);
  });

  it("throws when access_token is missing", async () => {
    mockFetch(jsonResponse({ token_type: "bearer" }));
    await expect(exchangeCodeForToken("id", "secret", "c", "r")).rejects.toThrow(/no access_token/);
  });
});

describe("waitForCallback", () => {
  const PORT = 45991;

  it("resolves with the code when state matches", async () => {
    const { promise } = waitForCallback(PORT, "expected-state");
    const res = await fetch(`http://localhost:${PORT}/callback?code=the-code&state=expected-state`);
    expect(res.status).toBe(200);
    await expect(promise).resolves.toBe("the-code");
  });

  it("rejects when Lawmatics returns an OAuth error (with matching state)", async () => {
    const { promise } = waitForCallback(PORT, "s");
    const assertion = expect(promise).rejects.toThrow(/access_denied/);
    await fetch(`http://localhost:${PORT}/callback?error=access_denied&state=s`);
    await assertion;
  });

  it("ignores an error callback with the wrong state (cannot be aborted by others)", async () => {
    const { promise, close } = waitForCallback(PORT, "right");
    const res = await fetch(`http://localhost:${PORT}/callback?error=access_denied&state=wrong`);
    expect(res.status).toBe(400);
    close();
    promise.catch(() => undefined);
  });

  it("400s on state mismatch and keeps waiting", async () => {
    const { promise, close } = waitForCallback(PORT, "right-state");
    const res = await fetch(`http://localhost:${PORT}/callback?code=x&state=wrong-state`);
    expect(res.status).toBe(400);
    close();
    // Silence the eventually-unresolved promise so vitest doesn't flag it.
    promise.catch(() => undefined);
  });
});
