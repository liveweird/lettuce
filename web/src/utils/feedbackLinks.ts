// Builders for the feedback flow URLs, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site. `back` is appended only when given,
// preserving the existing links that omit it.
function withBack(base: string, back?: string): string {
  return back ? `${base}&back=${encodeURIComponent(back)}` : base;
}

/** "Provide feedback" about a subject → the create editor (`/feedback/new`). */
export function feedbackProvideLink(subjectId: number, subjectName: string, back?: string): string {
  return withBack(`/feedback/new?subjectId=${subjectId}&subjectName=${encodeURIComponent(subjectName)}`, back);
}

/** "Ask for feedback" from a provider → the ask flow (`/feedback/ask`). */
export function feedbackAskLink(providerId: number, providerName: string, back?: string): string {
  return withBack(`/feedback/ask?providerId=${providerId}&providerName=${encodeURIComponent(providerName)}`, back);
}

/** "Request feedback" about a subject (manager flow) → the request flow (`/feedback/request`). */
export function feedbackRequestLink(subjectId: number, subjectName: string, back?: string): string {
  return withBack(`/feedback/request?subjectId=${subjectId}&subjectName=${encodeURIComponent(subjectName)}`, back);
}

/**
 * The per-person two-way feedbacks drill-down (`/users/:userId/feedbacks`). `from` names the
 * originating screen (an ORIGIN key of ManagerFeedbacks — drives its "Back to …" link); the
 * `members` origin additionally needs the `teamId` to link back to that team's roster. `tab`
 * targets a direction tab — ManagerFeedbacks itself uses it to build its round-trip `back` URLs.
 */
export function userFeedbacksLink(
  userId: number,
  name: string | null,
  from?: string,
  teamId?: number,
  tab?: string,
): string {
  const query = new URLSearchParams();
  if (name != null) query.set("name", name);
  if (from) query.set("from", from);
  if (teamId != null) query.set("teamId", String(teamId));
  if (tab) query.set("tab", tab);
  return `/users/${userId}/feedbacks?${query.toString()}`;
}
