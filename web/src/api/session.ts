// Session state — token/roles/feature-flag storage and the render-time accessors
// (transport lives in ./http).

import i18n, { asSupportedLanguage } from "../i18n";
import type { components } from "./schema";

type LoginSuccess = components["schemas"]["LoginResponse"];

const TOKEN_KEY = "lettuce.auth.token";
const REFRESH_TOKEN_KEY = "lettuce.auth.refreshToken";
const ROLES_KEY = "lettuce.auth.roles";
// Pre-roles-set sessions stored a single role under this key; clearSession removes it too.
const LEGACY_ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";
const SESSION_SYNC_KEY = "lettuce.auth.sessionSync";

export type SessionSnapshot = {
  generation: number;
  boundaryGeneration: number;
  identity: string | null;
  boundaryId: string | null;
  token: string | null;
  refreshToken: string | null;
  userId: string | null;
};

const sessionListeners = new Set<() => void>();
const boundaryListeners = new Set<() => void>();
let generation = 0;
let revision = 0;
let boundaryRevision = 0;
let syncSequence = 0;
let legacyStorageTimer: ReturnType<typeof setTimeout> | null = null;

type SessionMarker = { boundaryId: string; revision: string };

function readSessionMarker(raw = localStorage.getItem(SESSION_SYNC_KEY)): SessionMarker | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionMarker>;
    return typeof parsed.boundaryId === "string" && typeof parsed.revision === "string"
      ? { boundaryId: parsed.boundaryId, revision: parsed.revision }
      : null;
  } catch {
    return null;
  }
}

function createMarker(boundaryId: string): SessionMarker {
  syncSequence += 1;
  return {
    boundaryId,
    revision: `${Date.now()}:${syncSequence}:${crypto.randomUUID()}`,
  };
}

function ensureSessionMarker(): SessionMarker {
  const existing = readSessionMarker();
  if (existing !== null) return existing;
  const userId = localStorage.getItem(USER_ID_KEY);
  const marker = createMarker(userId === null ? "legacy-signed-out" : `legacy-user:${userId}`);
  localStorage.setItem(SESSION_SYNC_KEY, JSON.stringify(marker));
  return marker;
}

let lastSeenMarker = typeof localStorage === "undefined" ? null : ensureSessionMarker();

function storedCredentialFingerprint(): string {
  return `${getToken() ?? ""}\u0000${localStorage.getItem(USER_ID_KEY) ?? ""}`;
}

let lastSeenCredentials = typeof localStorage === "undefined" ? "" : storedCredentialFingerprint();

function storedIdentity(): string | null {
  const token = getToken();
  if (token === null) return null;
  return localStorage.getItem(USER_ID_KEY) ?? `token:${token}`;
}

function notifySessionChange(boundary: boolean): void {
  generation += 1;
  if (boundary) {
    boundaryRevision += 1;
    // Cache subscribers deliberately run before React auth subscribers. A render caused by
    // the transition must never observe the previous identity's queries or mutations.
    boundaryListeners.forEach((listener) => listener());
  }
  revision += 1;
  sessionListeners.forEach((listener) => listener());
}

function publishSessionChange(boundary: boolean): void {
  syncSequence += 1;
  const marker = createMarker(
    boundary
      ? `${Date.now()}:${syncSequence}:${crypto.randomUUID()}`
      : ensureSessionMarker().boundaryId,
  );
  lastSeenMarker = marker;
  lastSeenCredentials = storedCredentialFingerprint();
  localStorage.setItem(SESSION_SYNC_KEY, JSON.stringify(marker));
  notifySessionChange(boundary);
}

function syncFromStorage(): void {
  const marker = readSessionMarker();
  if (marker?.revision === lastSeenMarker?.revision) return;
  const boundary = marker?.boundaryId !== lastSeenMarker?.boundaryId;
  lastSeenMarker = marker;
  lastSeenCredentials = storedCredentialFingerprint();
  notifySessionChange(boundary);
}

function scheduleLegacyStorageFallback(): void {
  if (legacyStorageTimer !== null) clearTimeout(legacyStorageTimer);
  const markerRevision = lastSeenMarker?.revision;
  legacyStorageTimer = setTimeout(() => {
    legacyStorageTimer = null;
    if (readSessionMarker()?.revision === markerRevision) {
      // A pre-marker tab changed credentials. There is no reliable way to distinguish its
      // refresh from a direct account switch, so choose the safe cache/remount boundary.
      lastSeenCredentials = storedCredentialFingerprint();
      notifySessionChange(true);
    }
  }, 0);
}

function cancelLegacyStorageFallback(): void {
  if (legacyStorageTimer !== null) {
    clearTimeout(legacyStorageTimer);
    legacyStorageTimer = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== null && event.storageArea !== localStorage) return;
    if (event.key === null) {
      cancelLegacyStorageFallback();
      lastSeenMarker = readSessionMarker();
      lastSeenCredentials = storedCredentialFingerprint();
      notifySessionChange(true);
      return;
    }
    if (event.key === SESSION_SYNC_KEY) {
      cancelLegacyStorageFallback();
      // Read the latest committed marker. Event payloads may arrive after a newer login.
      syncFromStorage();
      return;
    }
    // Compatibility with tabs running a version from before SESSION_SYNC_KEY. Token
    // appearance/disappearance is an identity boundary; metadata/token rotation still
    // prompts a coherent render-time reread of roles and feature flags.
    if (event.key === TOKEN_KEY || event.key === USER_ID_KEY) {
      if (storedCredentialFingerprint() !== lastSeenCredentials) {
        scheduleLegacyStorageFallback();
      }
    }
  });
}

export function subscribeSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function subscribeSessionBoundary(listener: () => void): () => void {
  boundaryListeners.add(listener);
  return () => boundaryListeners.delete(listener);
}

export function getSessionRevision(): number {
  return revision;
}

export function getSessionBoundaryRevision(): number {
  return boundaryRevision;
}

export function captureSession(): SessionSnapshot {
  const marker = ensureSessionMarker();
  return {
    generation,
    boundaryGeneration: boundaryRevision,
    identity: storedIdentity(),
    boundaryId: marker.boundaryId,
    token: getToken(),
    refreshToken: getRefreshToken(),
    userId: localStorage.getItem(USER_ID_KEY),
  };
}

export function isSessionBoundaryCurrent(snapshot: SessionSnapshot): boolean {
  return snapshot.boundaryGeneration === boundaryRevision
    && snapshot.identity === storedIdentity()
    && snapshot.boundaryId === (readSessionMarker()?.boundaryId ?? null);
}

/** Includes stored values so another tab's writes invalidate work before its event is delivered. */
export function isSessionCurrent(snapshot: SessionSnapshot): boolean {
  return snapshot.generation === generation
    && snapshot.boundaryId === (readSessionMarker()?.boundaryId ?? null)
    && snapshot.token === getToken()
    && snapshot.refreshToken === getRefreshToken()
    && snapshot.userId === localStorage.getItem(USER_ID_KEY);
}

export class SessionChangedError extends Error {
  constructor() {
    super("Session changed while the request was in flight");
    this.name = "SessionChangedError";
  }
}

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
  SUCCESSION_PLANS: true,
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

function getRefreshToken(): string | null {
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
  publishSessionChange(true);
}

// Persist the access + refresh pair (and the current roles/userId/feature flags) returned by
// /login, /login/mfa, or /refresh. `?? []` keeps a mid-deploy older server (no disabledFeatures
// yet) harmless.
function writeSession(data: LoginSuccess): void {
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

/** A completed login always starts a new cache/component-state boundary. */
export function persistSession(data: LoginSuccess): void {
  writeSession(data);
  publishSessionChange(true);
}

/** A refresh preserves same-user UI state unless its roles or feature access changed. */
export function persistRefreshedSession(data: LoginSuccess): SessionSnapshot {
  const authorizationChanged = JSON.stringify([...getRoles()].sort()) !== JSON.stringify([...data.roles].sort())
    || JSON.stringify([...getDisabledFeatures()].sort())
      !== JSON.stringify([...(data.disabledFeatures ?? [])].sort());
  writeSession(data);
  publishSessionChange(authorizationChanged);
  return captureSession();
}

/** Overwrite the stored disabled-feature set (the self-edit immediate-update path). */
export function setStoredDisabledFeatures(features: Feature[]): void {
  localStorage.setItem(DISABLED_FEATURES_KEY, JSON.stringify(features));
  publishSessionChange(true);
}
