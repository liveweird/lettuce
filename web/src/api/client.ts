import type { paths } from "./schema";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

export type UserRole = "ADMIN" | "USER";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function getRole(): UserRole | null {
  const raw = localStorage.getItem(ROLE_KEY);
  return raw === "ADMIN" || raw === "USER" ? raw : null;
}

export function getUserId(): number | null {
  const raw = localStorage.getItem(USER_ID_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAdmin(): boolean {
  return getRole() === "ADMIN";
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

type LoginBody = paths["/api/login"]["post"]["requestBody"]["content"]["application/json"];
type LoginOk = paths["/api/login"]["post"]["responses"]["200"]["content"]["application/json"];

export async function login(credentials: LoginBody): Promise<LoginOk> {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  const data = (await res.json()) as LoginOk;
  setToken(data.token);
  localStorage.setItem(ROLE_KEY, data.role);
  localStorage.setItem(USER_ID_KEY, String(data.userId));
  return data;
}

export async function logout(): Promise<void> {
  const token = getToken();
  if (!token) return;
  await fetch(`${API_BASE}/api/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  clearSession();
}

export type UserPage = paths["/api/users"]["get"]["responses"]["200"]["content"]["application/json"];

export type UserListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  name?: string;
  email?: string;
  role?: UserRole;
};

export type CurrentUser = paths["/api/users/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

export async function getCurrentUser(): Promise<CurrentUser> {
  const id = getUserId();
  if (id === null) throw new ApiError(401, null);
  const res = await authedFetch(`/api/users/${id}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CurrentUser;
}

export type CreateUserBody = paths["/api/users"]["post"]["requestBody"]["content"]["application/json"];
export type CreateUserResponse = paths["/api/users"]["post"]["responses"]["201"]["content"]["application/json"];

export async function createUser(req: CreateUserBody): Promise<CreateUserResponse> {
  const res = await authedFetch("/api/users", {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as CreateUserResponse;
}

export async function listUsers(q: UserListQuery): Promise<UserPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  if (q.sort) params.set("sort", q.sort);
  if (q.name) params.set("name", q.name);
  if (q.email) params.set("email", q.email);
  if (q.role) params.set("role", q.role);
  const res = await authedFetch(`/api/users?${params.toString()}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return (await res.json()) as UserPage;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) clearSession();
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
