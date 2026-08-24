// Session state — token/roles/feature-flag storage and the render-time accessors
// (transport lives in ./http).

import i18n, { asSupportedLanguage } from "../i18n";
import type { components } from "./schema";

type LoginSuccess = components["schemas"]["LoginResponse"];

export const TOKEN_KEY = "lettuce.auth.token";
const REFRESH_TOKEN_KEY = "lettuce.auth.refreshToken";
const ROLES_KEY = "lettuce.auth.roles";
// Pre-roles-set sessions stored a single role under this key; clearSession removes it too.
const LEGACY_ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

/** Additional roles — every user is implicitly a regular user; an empty set means no extra privileges. */
export const USER_ROLES = ["ADMIN", "HR"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const DISABLED_FEATURES_KEY = "lettuce.auth.disabledFeatures";

/**
 * The per-user-toggleable feature areas (v1.53.0), in the UI's display order.
 * MFA (v2.4.0) is the one inverted-default flag: every user starts with it DISABLED
 * (opt-in email MFA at login); it gates the login flow server-side, never any SPA surface —
 * no nav leaf, page guard, or card gating names it.
 */
// Compile gate (the EMOJI_I18N idiom): keyed by the GENERATED schema union, so adding a
// server-side Feature and regenerating schema.ts is a type error here until the flag is
// listed — the flags UIs and the stored-set filter can never silently drop a new feature.
// Key order is the UI display order.
const FEATURE_LISTED: Record<components["schemas"]["Feature"], true> = {
  FEEDBACKS: true,
  ONE_ON_ONES: true,
  GOALS: true,
  IMPACT_LOG: true,
  TEAM_KPIS: true,
  PERFORMANCE_REVIEWS: true,
  DAYS_OFF: true,
  PULSE_SURVEYS: true,
  MFA: true,
};
export const FEATURES = Object.keys(FEATURE_LISTED) as readonly Feature[];
export type Feature = components["schemas"]["Feature"];

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setRefreshToken(token: string | null): void {
  if (token === null) localStorage.removeItem(REFRESH_TOKEN_KEY);
  else localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getRoles(): UserRole[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROLES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is UserRole => USER_ROLES.includes(r)) : [];
  } catch {
    return [];
  }
}

export function getUserId(): number | null {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The session user's admin-disabled features. Missing key or corrupt value = all enabled —
 * pre-v1.53.0 sessions (and mid-deploy older servers) keep full access until their next
 * login/refresh. Render-time reads like isAdmin() — a change reaches a logged-in victim via
 * the ≤15-min token refresh, and route guards + server 403s cover the gap.
 */
export function getDisabledFeatures(): Feature[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISABLED_FEATURES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((f): f is Feature => FEATURES.includes(f)) : [];
  } catch {
    return [];
  }
}

export function hasFeature(feature: Feature): boolean {
  return !getDisabledFeatures().includes(feature);
}

export function isAdmin(): boolean {
  return getRoles().includes("ADMIN");
}

export function isHr(): boolean {
  return getRoles().includes("HR");
}

/** May use the auditor read surface (view=user + the Audit section) — HR-only since v1.26.0. */
export function canAudit(): boolean {
  return isHr();
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ROLES_KEY);
  localStorage.removeItem(LEGACY_ROLE_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(DISABLED_FEATURES_KEY);
}

// Persist the access + refresh pair (and the current roles/userId/feature flags) returned by
// /login, /login/mfa, or /refresh. `?? []` keeps a mid-deploy older server (no disabledFeatures
// yet) harmless.
export function persistSession(data: LoginSuccess): void {
  setToken(data.token);
  setRefreshToken(data.refreshToken);
  localStorage.setItem(ROLES_KEY, JSON.stringify(data.roles));
  localStorage.setItem(USER_ID_KEY, String(data.userId));
  localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(data.disabledFeatures ?? []));
  // Apply the user's stored language (V61) — one chokepoint covers login, the MFA step, and
  // the silent refresh (so an admin change propagates within the refresh window). The
  // inequality guard avoids re-firing languageChanged app-wide on every refresh; the
  // data.language truthiness guard keeps a mid-deploy older server harmless (the
  // disabledFeatures ?? [] precedent). changeLanguage caches to lettuce.lang, so the stored
  // language also becomes the device language.
  const lang = asSupportedLanguage(data.language);
  if (data.language && lang !== asSupportedLanguage(i18n.resolvedLanguage)) {
    void i18n.changeLanguage(lang);
  }
}

/** Overwrite the stored disabled-feature set (the self-edit immediate-update path). */
export function setStoredDisabledFeatures(features: Feature[]): void {
  localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(features));
}
