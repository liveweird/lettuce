import { drillDownOptsSearch, type DrillDownOpts } from "./linkSearch";

// Builders for the feedback flow URLs, so the query-string shape (and encodeURIComponent) lives in
// one place instead of being hand-assembled at every call site. `back` is appended only when given,
// preserving the existing links that omit it.
function withBack(base: string, back?: string): string {
  return back ? `${base}&back=${encodeURIComponent(back)}` : base;
}

/** "Provide feedback" about a subject → the create editor (`/feedback/new`). The screen
 *  resolves the subject's display name from the org pool (v2.35.0, never a URL param). */
export function feedbackProvideLink(subjectId: number, back?: string): string {
  return withBack(`/feedback/new?subjectId=${subjectId}`, back);
}

/** "New feedback" with NO subject → the create editor in picker mode (v2.28.0). Not
 *  `withBack` — this is the one builder whose base carries no query string of its own. */
export function feedbackCreateLink(back?: string): string {
  return back ? `/feedback/new?back=${encodeURIComponent(back)}` : "/feedback/new";
}

/** "Ask for feedback" from a provider → the ask flow (`/feedback/ask`). */
export function feedbackAskLink(providerId: number, back?: string): string {
  return withBack(`/feedback/ask?providerId=${providerId}`, back);
}

/** "Request feedback" about a subject (manager flow) → the request flow (`/feedback/request`). */
export function feedbackRequestLink(subjectId: number, back?: string): string {
  return withBack(`/feedback/request?subjectId=${subjectId}`, back);
}

/**
 * Optional addressing for the view/edit detail screens. `as` picks the provider/team reading
 * of a row the caller is a party to; `back` overrides the return target (the FeedbackTable
 * embeddings); `from` marks the team-view origin on edit links. The party-name params are
 * gone (v2.35.0): headers render the fetched record's names only.
 */
export type FeedbackDetailOpts = {
  as?: "provider" | "team";
  from?: string;
  back?: string;
};

function feedbackDetailSearch(opts?: FeedbackDetailOpts): string {
  const parts: string[] = [];
  if (opts?.as) parts.push(`as=${opts.as}`);
  if (opts?.from) parts.push(`from=${opts.from}`);
  if (opts?.back) parts.push(`back=${encodeURIComponent(opts.back)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The read-only feedback document (`/feedback/:id/view`). */
export function feedbackViewLink(id: number, opts?: FeedbackDetailOpts): string {
  return `/feedback/${id}/view${feedbackDetailSearch(opts)}`;
}

/** The feedback editor (`/feedback/:id/edit`). */
export function feedbackEditLink(id: number, opts?: FeedbackDetailOpts): string {
  return `/feedback/${id}/edit${feedbackDetailSearch(opts)}`;
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
