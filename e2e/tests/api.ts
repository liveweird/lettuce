import { type APIRequestContext } from "@playwright/test";
import { PASSWORD } from "./helpers";

// Shared API-side login for specs that talk to the server directly (residue sweeps, probes,
// survey fills). One implementation of the 429 retry ladder — the per-IP /login bucket answers
// 429 under suite pressure, and a one-shot login would flake the sweep. Previously duplicated
// file-locally by days-off.spec.ts, pulse.spec.ts, and hr.spec.ts.
const LOGIN_ATTEMPTS = 12;
const LOGIN_RETRY_WAIT_MS = 10_000;

/** Log in over the API and return the bearer token, waiting out per-IP 429s. */
export async function apiToken(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
): Promise<string> {
  for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt++) {
    const res = await request.post("/api/v1/login", { data: { email, password } });
    if (res.ok()) return ((await res.json()) as { token: string }).token;
    if (res.status() !== 429) break;
    await new Promise((r) => setTimeout(r, LOGIN_RETRY_WAIT_MS));
  }
  throw new Error(`apiToken: could not log in as ${email}`);
}

/** The Authorization header object for [token] — the sweeps build it per actor. */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
