// Shared test helper: a JSON Response for fetch mocks (previously copy-pasted per test file).
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// The drill-down headings resolve a person with ONE `GET /api/v1/users?id=<n>&page=1&pageSize=1`
// lookup (v4.15.0 — they used to page the whole directory). Answers it from [roster]: a one-row
// page for a known id, an empty page otherwise (the server's 200-with-no-rows, never a 404).
export function userLookupResponse<T extends { id: number }>(url: string, roster: T[]): Response {
  const ids = new URL(url, "http://localhost").searchParams.getAll("id").map(Number);
  const items = roster.filter((u) => ids.includes(u.id));
  return jsonResponse(200, { items, page: 1, pageSize: 1, total: items.length });
}

// The `GET /api/v1/users?…` requests a fetch mock saw (the F9 assertions: one `id=` lookup, no 100-row pool page).
export function usersListRequests(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/v1/users?"));
}
