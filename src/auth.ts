/**
 * One-time OAuth flow, run as `npx @oktopeak/lawmatics-mcp auth`.
 *
 * Lawmatics only supports the authorization_code grant, but the resulting
 * access token NEVER expires (there is no refresh token), so this dance runs
 * exactly once. The token is printed for the user to paste into their MCP
 * config as LAWMATICS_ACCESS_TOKEN — no token storage in this package.
 */
import http from "http";
import { randomBytes } from "crypto";

const DEFAULT_PORT = 5678;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export function getAuthorizeBase(): string {
  return process.env.LAWMATICS_AUTHORIZE_URL ?? "https://app.lawmatics.com/oauth/authorize";
}

export function getTokenUrl(): string {
  return process.env.LAWMATICS_TOKEN_URL ?? "https://api.lawmatics.com/oauth/token";
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(getAuthorizeBase());
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  const token = (parsed as { access_token?: unknown }).access_token;
  if (typeof token !== "string" || !token) {
    throw new Error(`Token endpoint response had no access_token: ${text.slice(0, 200)}`);
  }
  return token;
}

/** Waits for the OAuth redirect on localhost and returns the authorization code. */
export function waitForCallback(
  port: number,
  expectedState: string
): { promise: Promise<string>; close: () => void } {
  let server: http.Server;
  // close() alone leaves speculative keep-alive sockets holding the event loop
  // open for up to 60s after success — destroy them too.
  const closeServer = () => {
    server?.close();
    server?.closeAllConnections?.();
  };
  const promise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      closeServer();
      reject(new Error("Timed out waiting for the OAuth redirect (5 minutes)."));
    }, AUTH_TIMEOUT_MS);

    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      // Every branch requires the state to match, including errors — otherwise
      // any local process could abort an in-progress flow.
      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Invalid callback.</h2><p>State mismatch. Re-run the auth command.</p>");
        return;
      }
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authorization failed.</h2><p>You can close this tab.</p>");
        clearTimeout(timer);
        closeServer();
        reject(new Error(`Lawmatics returned an OAuth error: ${err}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Invalid callback.</h2><p>Missing authorization code. Re-run the auth command.</p>");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Connected to Lawmatics ✔</h2><p>Return to your terminal. You can close this tab.</p>");
      clearTimeout(timer);
      closeServer();
      resolve(code);
    });

    server.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not listen on port ${port}: ${e.message}. Set LAWMATICS_REDIRECT_PORT to a free port.`));
    });
    // Bind loopback only — the callback must never be reachable from the LAN.
    server.listen(port, "127.0.0.1");
  });

  return { promise, close: closeServer };
}

export async function runAuthFlow(): Promise<void> {
  const clientId = process.env.LAWMATICS_CLIENT_ID;
  const clientSecret = process.env.LAWMATICS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(`
Missing LAWMATICS_CLIENT_ID / LAWMATICS_CLIENT_SECRET.

1. Ask Lawmatics support (or api@lawmatics.com) to enable Developer Settings on your account.
2. In Lawmatics: Settings -> Developers -> create an app.
   Set the Callback URL to: http://localhost:${process.env.LAWMATICS_REDIRECT_PORT ?? DEFAULT_PORT}/callback
3. Re-run with the credentials:

   LAWMATICS_CLIENT_ID=xxx LAWMATICS_CLIENT_SECRET=yyy npx @oktopeak/lawmatics-mcp auth
`);
    process.exitCode = 1;
    return;
  }

  const port = parseInt(process.env.LAWMATICS_REDIRECT_PORT ?? "", 10) || DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, state);

  const { promise } = waitForCallback(port, state);

  console.error(`
Open this URL in your browser and approve access:

  ${authorizeUrl}

(Your Lawmatics app's Callback URL must be exactly: ${redirectUri})

Waiting for the redirect...`);

  const code = await promise;
  const token = await exchangeCodeForToken(clientId, clientSecret, code, redirectUri);

  console.error(`
Success! Your Lawmatics access token (it never expires — store it like a password):

  ${token}

Add it to your Claude Desktop config:

  "lawmatics": {
    "command": "npx",
    "args": ["-y", "@oktopeak/lawmatics-mcp"],
    "env": { "LAWMATICS_ACCESS_TOKEN": "${token}" }
  }
`);
}
