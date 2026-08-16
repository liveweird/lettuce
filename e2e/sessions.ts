/** The /login response fields the SPA persists. */
export interface LoginBody {
  token: string;
  refreshToken: string;
  roles: string[];
  userId: number;
  disabledFeatures?: string[];
}

/**
 * The localStorage a signed-in SPA holds: exactly the five keys `persistSession` writes in
 * web/src/api/session.ts. Writing them is equivalent to having driven the login form, which lets
 * helpers.login() skip it — see "Logging in" in e2e/README.md. If that key set ever changes, the
 * injected session simply fails to authenticate and the helper falls back to the real form.
 */
export function sessionEntries(body: LoginBody): [string, string][] {
  return [
    ["lettuce.auth.token", body.token],
    ["lettuce.auth.refreshToken", body.refreshToken],
    ["lettuce.auth.roles", JSON.stringify(body.roles)],
    ["lettuce.auth.userId", String(body.userId)],
    ["lettuce.auth.disabledFeatures", JSON.stringify(body.disabledFeatures ?? [])],
  ];
}

/** Every key the SPA's own clearSession() removes; a leftover one makes /login bounce home. */
export const AUTH_KEY_PREFIX = "lettuce.auth.";
