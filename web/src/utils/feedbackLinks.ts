// Builders for the feedback flow URLs, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site. `back` is appended only when given,
// preserving the existing links that omit it.
function withBack(base: string, back?: string): string {
  return back ? `${base}&back=${encodeURIComponent(back)}` : base;
}

/**
 * Optional drill-down addressing shared by the four per-user drill-down builders
 * (feedbacks/1:1s/goals/reviews): `back` overrides the screen's "Back to …" target — the
 * details-page round-trip, where `from` alone would lose the details page's own origin —
 * and `manages` asserts the caller-manages relationship (`manages=1`) so `from=details`
 * keeps the manager-only affordances (New goal / New 1:1 / New review).
 */
export type DrillDownOpts = { back?: string; manages?: boolean };

/** Serializes [DrillDownOpts] as a `&`-prefixed query suffix ("" when empty). */
export function drillDownOptsSearch(opts?: DrillDownOpts): string {
  let suffix = "";
  if (opts?.back) suffix += `&back=${encodeURIComponent(opts.back)}`;
  if (opts?.manages) suffix += `&manages=1`;
  return suffix;
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
  audit?: boolean,
  opts?: DrillDownOpts,
): string {
  const query = new URLSearchParams();
  if (name != null) query.set("name", name);
  if (from) query.set("from", from);
  if (teamId != null) query.set("teamId", String(teamId));
  if (tab) query.set("tab", tab);
  if (audit) query.set("mode", "audit");
  return `/users/${userId}/feedbacks?${query.toString()}${drillDownOptsSearch(opts)}`;
}
