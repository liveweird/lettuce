// Transport — authedFetch with the single-flighted silent refresh, ApiError, and the
// shared JSON helpers (session state lives in ./session).

import { flagSignedOut } from "../auth";
import type { components } from "./schema";
import {
  captureSession,
  clearSession,
  isSessionBoundaryCurrent,
  isSessionCurrent,
  persistRefreshedSession,
  SessionChangedError,
  type SessionSnapshot,
} from "./session";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type LoginSuccess = components["schemas"]["LoginResponse"];

function isLoginSuccess(data: unknown): data is LoginSuccess {
  if (data === null || typeof data !== "object") return false;
  const candidate = data as Partial<LoginSuccess>;
  return typeof candidate.token === "string"
    && typeof candidate.refreshToken === "string"
    && typeof candidate.userId === "number"
    && Number.isFinite(candidate.userId)
    && Array.isArray(candidate.roles)
    && (candidate.disabledFeatures === undefined || Array.isArray(candidate.disabledFeatures));
}

// Every request gets a deadline (v2.22.0) — without one a hung response leaves the promise
// pending forever, with buttons stuck in their loading state and no error ever shown.
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The default per-request deadline: rejects the fetch with a "TimeoutError" DOMException
 * after 30 s. Callers may override by passing their own `signal`. Feature-detected because
 * happy-dom (tests) lacks AbortSignal.timeout.
 */
export function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

/** True for the transport deadline's rejection — the server did not answer in time. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

// The refresh outcome distinguishes a DEFINITIVE rejection (the session is over) from a
// TRANSIENT failure (network blip, timeout, 5xx, the refresh rate bucket's 429, a malformed
// body) — only the former may destroy the stored session: the refresh token is still valid
// through a transient failure, so signing the user out would discard a working session (and
// any in-progress form) over a hiccup.
type RefreshOutcome =
  | { kind: "ok"; token: string; session: SessionSnapshot }
  | { kind: "rejected" }
  | { kind: "unavailable" }
  | { kind: "stale" };

// Exchange the stored refresh token for a fresh access + refresh pair. Single-flighted:
// concurrent callers (e.g. several requests that all 401 at once) share one in-flight
// /refresh call.
type RefreshFlight = { session: SessionSnapshot; promise: Promise<RefreshOutcome> };
let refreshInflight: RefreshFlight | null = null;
const responseSessions = new WeakMap<Response, SessionSnapshot>();

function rememberResponseSession(response: Response, session: SessionSnapshot): Response {
  responseSessions.set(response, session);
  return response;
}

function assertResponseSession(response: Response): void {
  const session = responseSessions.get(response);
  if (session && !isSessionBoundaryCurrent(session)) throw new SessionChangedError();
}

function sameSession(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return a.generation === b.generation
    && a.token === b.token
    && a.refreshToken === b.refreshToken
    && a.userId === b.userId;
}

function refresh(session: SessionSnapshot): Promise<RefreshOutcome> {
  if (refreshInflight === null || !sameSession(refreshInflight.session, session)) {
    const flight: RefreshFlight = {
      session,
      promise: Promise.resolve({ kind: "stale" }),
    };
    flight.promise = doRefresh(session).finally(() => {
      // An old flight may finish after a new identity has started its own refresh.
      if (refreshInflight === flight) refreshInflight = null;
    });
    refreshInflight = flight;
  }
  return refreshInflight.promise;
}

async function doRefresh(session: SessionSnapshot): Promise<RefreshOutcome> {
  const refreshToken = session.refreshToken;
  if (!refreshToken) return { kind: "rejected" };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: timeoutSignal(),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { kind: "rejected" };
  if (!res.ok) return { kind: "unavailable" };
  let data: unknown;
  try {
    data = (await res.json()) as LoginSuccess;
  } catch {
    return { kind: "unavailable" };
  }
  if (!isLoginSuccess(data)) return { kind: "unavailable" };
  if (!isSessionCurrent(session)) return { kind: "stale" };
  const refreshedSession = persistRefreshedSession(data);
  return { kind: "ok", token: data.token, session: refreshedSession };
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const requestSession = captureSession();
  let res = await sendWithToken(path, init, requestSession.token);
  if (!isSessionBoundaryCurrent(requestSession)) throw new SessionChangedError();
  if (res.status === 401) {
    if (!isSessionCurrent(requestSession)) {
      // Another request/tab already refreshed this same identity while the original was in
      // flight. Retry with that rotated access token, but never across an identity boundary.
      const rotatedSession = captureSession();
      res = await sendWithToken(path, init, rotatedSession.token);
      if (!isSessionBoundaryCurrent(rotatedSession)) throw new SessionChangedError();
      return rememberResponseSession(res, rotatedSession);
    }
    // The access token is likely expired. Try one silent refresh (single-flighted), then retry once.
    const outcome = await refresh(requestSession);
    if (outcome.kind === "ok") {
      if (!isSessionCurrent(outcome.session)) throw new SessionChangedError();
      res = await sendWithToken(path, init, outcome.token);
      if (!isSessionBoundaryCurrent(outcome.session)) throw new SessionChangedError();
      return rememberResponseSession(res, outcome.session);
    } else if (outcome.kind === "rejected" && isSessionCurrent(requestSession)) {
      // No refresh token, or the server rejected it — the session is over.
      flagSignedOut();
      clearSession();
      return res;
    }
    if (!isSessionBoundaryCurrent(requestSession)) {
      throw new SessionChangedError();
    }
    // "unavailable": keep the session — the original 401 becomes the caller's error and a
    // later retry (the tokens are untouched) can succeed once the server is reachable again.
  }
  return rememberResponseSession(res, requestSession);
}

function sendWithToken(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${API_BASE}${path}`, { signal: timeoutSignal(), ...init, headers });
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }

  /** The RFC 7807 `detail` string, when the problem body carried one. */
  get detail(): string | undefined {
    return this.problemField("detail");
  }

  /** The RFC 7807 `instance` path, when the problem body carried one. */
  get instance(): string | undefined {
    return this.problemField("instance");
  }

  private problemField(field: "detail" | "instance"): string | undefined {
    const value = (this.body as Record<string, unknown> | null)?.[field];
    return typeof value === "string" ? value : undefined;
  }
}

/**
 * The QueryClient's retry policy (wired in main.tsx): never retry a 4xx — the server's
 * answer won't change, and retrying only delays the error UI (a 403 used to sit behind
 * ~7 s of backoff); transient failures (network, timeout, 5xx) get up to two retries.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 2
    && !(error instanceof SessionChangedError)
    && !(error instanceof ApiError && error.status >= 400 && error.status < 500);
}

export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * The two standard wrapper shapes (2026-08 review round, CR-008) — previously the ok-check +
 * ProblemDetail-body + parse trio was hand-copied ~119 times across the feature modules. New
 * endpoint wrappers use these; `authedFetch`/`ApiError`/`safeJson` stay exported for the
 * special cases (extra response logic, non-authed auth flows).
 */
export async function jsonRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(input, init);
  if (!res.ok) {
    const body = await safeJson(res);
    assertResponseSession(res);
    throw new ApiError(res.status, body);
  }
  const data = (await res.json()) as T;
  assertResponseSession(res);
  return data;
}

/** [jsonRequest]'s sibling for 201/204-style responses whose body is ignored. */
export async function voidRequest(input: string, init?: RequestInit): Promise<void> {
  const res = await authedFetch(input, init);
  if (!res.ok) {
    const body = await safeJson(res);
    assertResponseSession(res);
    throw new ApiError(res.status, body);
  }
  assertResponseSession(res);
}

/**
 * The list wrappers' query-string builder — replaces the per-module `URLSearchParams`
 * ladders (2026-08 review round). Skips null/undefined/"" (an absent or cleared filter);
 * `false` and `0` ARE sent (wasSeen=false, deactivated=false are meaningful filters) — a
 * field that must be OMITTED when false (`includeIndirect`) is passed as `value || undefined`
 * at the call site.
 */
export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}
