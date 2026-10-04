import { request as playwrightRequest } from "@playwright/test";
import { sessionEntries, type LoginBody } from "../sessions";
import { PERF_BASE_URL } from "./env";
import { credentials, type PersonaKey } from "./personas";

export interface PerfSession {
  /** The five `lettuce.auth.*` localStorage entries a signed-in SPA holds. */
  entries: [string, string][];
  userId: number;
}

/**
 * Mints a session over the API and returns the SPA's own localStorage entries (e2e/sessions.ts `sessionEntries`). Not
 * `helpers.login()`: its "explicit password -> the real form" rule is deliberate for the e2e suite, and a form login would
 * put typing, a navigation and bcrypt-bound UI latency in front of every measurement. Never logs out — a logout would
 * revoke the tokens the next iteration reuses.
 */
export async function mintSession(persona: PersonaKey): Promise<PerfSession> {
  const { email, password } = credentials(persona);
  const api = await playwrightRequest.newContext({ baseURL: PERF_BASE_URL });
  try {
    const res = await api.post("/api/v1/login", { data: { email, password } });
    if (!res.ok()) {
      throw new Error(
        `login failed for persona '${persona}' (HTTP ${res.status()}) — is the perf dataset seeded and the app up? ` +
          `(PERF_SMOKE=1 uses the dev stack's seed accounts instead)`,
      );
    }
    const body = (await res.json()) as Partial<LoginBody>;
    if (!body.token || !body.refreshToken || !body.roles || body.userId === undefined) {
      throw new Error(`login for persona '${persona}' returned no token pair (an MFA challenge?)`);
    }
    return { entries: sessionEntries(body as LoginBody), userId: body.userId };
  } finally {
    await api.dispose();
  }
}

const userIds = new Map<PersonaKey, number>();

/** The user id of another persona (for drill-down routes); minted once per worker, ids never change. */
export async function userIdOf(persona: PersonaKey): Promise<number> {
  const known = userIds.get(persona);
  if (known !== undefined) return known;
  const id = (await mintSession(persona)).userId;
  userIds.set(persona, id);
  return id;
}
