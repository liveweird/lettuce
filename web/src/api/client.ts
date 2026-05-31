import type { paths } from "./schema";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "lettuce.auth.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

type LoginBody = paths["/login"]["post"]["requestBody"]["content"]["application/json"];
type LoginOk = paths["/login"]["post"]["responses"]["200"]["content"]["application/json"];

export async function login(credentials: LoginBody): Promise<LoginOk> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  const data = (await res.json()) as LoginOk;
  setToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch(`${API_BASE}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  setToken(null);
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) setToken(null);
  return res;
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

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
