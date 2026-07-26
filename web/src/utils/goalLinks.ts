// Builders for every goal-flow URL, so the query-string shape (and encodeURIComponent) lives
// in one place instead of being hand-assembled at call sites — the feedbackLinks pattern.
// Optional parts are appended only when given.

/** The goal create screen, optionally prefilled with the subordinate and a return target. */
export function goalCreateLink(
  subordinateId: number,
  subordinateName?: string | null,
  back?: string,
): string {
  let url = `/goals/new?subordinateId=${subordinateId}`;
  if (subordinateName) url += `&subordinateName=${encodeURIComponent(subordinateName)}`;
  if (back) url += `&back=${encodeURIComponent(back)}`;
  return url;
}

function detailSearch(from?: string, back?: string): string {
  const parts: string[] = [];
  if (from) parts.push(`from=${from}`);
  if (back) parts.push(`back=${encodeURIComponent(back)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The read-only goal document. */
export function goalViewLink(id: number, from?: string, back?: string): string {
  return `/goals/${id}/view${detailSearch(from, back)}`;
}

/** The status-branching goal editor. */
export function goalEditLink(id: number, from?: string, back?: string): string {
  return `/goals/${id}/edit${detailSearch(from, back)}`;
}

/** The per-user goals drill-down (`/users/:id/goals`), as linked from the dashboard cards. */
export function userGoalsLink(userId: number, name: string, from: "managers" | "subordinates"): string {
  return `/users/${userId}/goals?name=${encodeURIComponent(name)}&from=${from}`;
}
