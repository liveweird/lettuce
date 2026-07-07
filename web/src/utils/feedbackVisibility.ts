import type { FeedbackVisibility } from "../api/client";

// The single frontend home of the feedback-visibility domain rule (mirrors the backend
// invariants): a requester-backed feedback must keep a requester-inclusive visibility
// (otherwise saving would strip the requester's read access — and the server rejects
// requester+PROVIDER_SUBJECT), while a plain one offers Provider+subject / Public
// (the server likewise rejects PROVIDER_REQUESTER without a requester).

export const REQUESTER_VISIBILITIES: FeedbackVisibility[] = [
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

export const NO_REQUESTER_VISIBILITIES: FeedbackVisibility[] = ["PROVIDER_SUBJECT", "PUBLIC"];

// The full domain, for FILTER dropdowns: list views can contain rows of every visibility
// (e.g. the caller's own requests appear in Received at any visibility), so the table
// filters offer all values. Form option sets stay the requester-derived subsets above.
export const ALL_VISIBILITIES: FeedbackVisibility[] = [
  "PROVIDER_SUBJECT",
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

export function visibilityValuesFor(hasRequester: boolean): FeedbackVisibility[] {
  return hasRequester ? REQUESTER_VISIBILITIES : NO_REQUESTER_VISIBILITIES;
}

// Keep a preselected value within the offered set; if the stored visibility is out of set, fall
// back to a sensible default (the most inclusive requester option, or Provider+subject otherwise).
export function clampVisibility(v: FeedbackVisibility, hasRequester: boolean): FeedbackVisibility {
  const allowed = visibilityValuesFor(hasRequester);
  if (allowed.includes(v)) return v;
  return hasRequester ? "PROVIDER_REQUESTER_SUBJECT" : "PROVIDER_SUBJECT";
}
