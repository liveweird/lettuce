// Transport — authedFetch with the single-flighted silent refresh, ApiError, and the
// shared JSON helpers (session state lives in ./session).

import { flagSignedOut, notifyAuthChange } from "../auth";
import type { components } from "./schema";
import { clearSession, getRefreshToken, getToken, persistSession } from "./session";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type LoginSuccess = components["schemas"]["LoginResponse"];

// Exchange the stored refresh token for a fresh access + refresh pair. Returns the new access token,
// or null if there is no refresh token or the server rejected it. Single-flighted: concurrent callers
// (e.g. several requests that all 401 at once) share one in-flight /refresh call.
let refreshInflight: Promise<string | null> | null = null;

function refresh(): Promise<string | null> {
  if (refreshInflight === null) {
    refreshInflight = doRefresh().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as LoginSuccess;
  persistSession(data);
  return data.token;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await sendWithToken(path, init, getToken());
  if (res.status === 401) {
    // The access token is likely expired. Try one silent refresh (single-flighted), then retry once.
    const newToken = await refresh();
    if (newToken !== null) {
      res = await sendWithToken(path, init, newToken);
    } else {
      // No refresh token, or the server rejected it — the session is over.
      clearSession();
      flagSignedOut();
      notifyAuthChange();
    }
  }
  return res;
}

function sendWithToken(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
