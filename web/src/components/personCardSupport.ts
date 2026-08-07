// The person-card action metadata, split out of PersonCardActions.tsx so that file keeps
// only component exports and stays compatible with React Fast Refresh
// (react-refresh/only-export-components) — the tourSupport.ts idiom.

import { hasFeature, type Feature } from "../api/client";

export type ButtonKey =
  | "provide"
  | "ask"
  | "request"
  | "newOneOnOne"
  | "feedbacks"
  | "oneOnOnes"
  | "goals"
  | "reviews"
  | "daysOff";

export type LabelPair = { aria: string; text: string };

// The feature each button belongs to (v1.53.0): a button renders only while the VIEWER has
// its feature enabled (caller-only semantics — the flags gate what the session user may do,
// never what the card's person has). Team KPIs never surface as a person-card action.
export const FEATURE_OF: Record<ButtonKey, Feature> = {
  provide: "FEEDBACKS",
  ask: "FEEDBACKS",
  request: "FEEDBACKS",
  feedbacks: "FEEDBACKS",
  newOneOnOne: "ONE_ON_ONES",
  oneOnOnes: "ONE_ON_ONES",
  goals: "GOALS",
  reviews: "PERFORMANCE_REVIEWS",
  daysOff: "DAYS_OFF",
};

export const PERSON_CARD_ACTION_LABELS: Record<
  "users" | "teams" | "audit",
  Partial<Record<ButtonKey, LabelPair>>
> = {
  users: {
    provide: { aria: "users.provideFeedbackTo", text: "users.provideFeedback" },
    ask: { aria: "users.askForFeedbackFrom", text: "users.askForFeedback" },
    // The drill-down texts are "… list" (v1.51.0) — under this flavor they sit inside (or next
    // to) the topic dropdowns; the audit table below keeps the plain nouns.
    feedbacks: { aria: "users.feedbacksWith", text: "users.feedbackList" },
    oneOnOnes: { aria: "users.oneOnOnesWith", text: "users.oneOnOneList" },
    goals: { aria: "users.goalsWith", text: "users.goals" },
  },
  teams: {
    provide: { aria: "teams.provideFeedbackToAria", text: "teams.provideFeedback" },
    ask: { aria: "teams.askForFeedbackAria", text: "teams.askForFeedback" },
    request: { aria: "teams.requestFeedbackAboutAria", text: "teams.requestFeedbackFor" },
    newOneOnOne: { aria: "teams.addOneOnOneWithAria", text: "teams.addOneOnOne" },
    feedbacks: { aria: "teams.feedbacksWithAria", text: "teams.feedbacks" },
    oneOnOnes: { aria: "teams.oneOnOnesWithAria", text: "teams.oneOnOnes" },
    goals: { aria: "teams.goalsForAria", text: "teams.goals" },
    reviews: { aria: "teams.performanceReviewsForAria", text: "teams.performanceReviews" },
    // v1.44.0: the manager-side per-report days-off drill-down.
    daysOff: { aria: "teams.daysOffForAria", text: "teams.daysOff" },
  },
  audit: {
    feedbacks: { aria: "users.audit.feedbacksAria", text: "users.feedbacks" },
    oneOnOnes: { aria: "users.audit.oneOnOnesAria", text: "users.oneOnOnes" },
    goals: { aria: "users.audit.goalsAria", text: "users.goals" },
    reviews: { aria: "users.audit.performanceReviewsAria", text: "users.performanceReviews" },
    // v1.42.0: days off are per-user, so the auditor drill-down fits (unlike team KPIs).
    daysOff: { aria: "users.audit.daysOffAria", text: "users.daysOff" },
  },
};

// The topic dropdowns (v1.51.0): the feedback create/drill-down actions and the 1:1 pair are
// grouped behind one trigger each (the FeedbackActionsMenu idiom), with per-flavor trigger
// labels. A group only becomes a dropdown when ≥2 of its actions are visible — a lone member
// renders as the plain button it always was, which is also why some flavors carry no trigger
// label at all: the `users` flavor has no New-1:1 (its 1:1 group can never reach 2) and the
// `audit` flavor is drill-downs only (every group is a singleton), so those keys would be dead.
export type ActionGroupId = "feedback" | "oneOnOne";

export type ActionGroup = {
  id: ActionGroupId;
  /** The group's members, in menu order (a subset of the fixed button order). */
  keys: readonly ButtonKey[];
  /** Trigger text+aria per flavor; a flavor without an entry never renders this dropdown. */
  label: Partial<Record<"users" | "teams", LabelPair>>;
};

export const ACTION_GROUPS: readonly ActionGroup[] = [
  {
    id: "feedback",
    keys: ["provide", "ask", "request", "feedbacks"],
    label: {
      users: { aria: "users.feedbackGroupAria", text: "users.feedbackGroup" },
      teams: { aria: "teams.feedbackGroupAria", text: "teams.feedbackGroup" },
    },
  },
  {
    id: "oneOnOne",
    keys: ["newOneOnOne", "oneOnOnes"],
    label: {
      teams: { aria: "teams.oneOnOneGroupAria", text: "teams.oneOnOneGroup" },
    },
  },
];

// The card sections' button subsets (v1.46.0): PersonCardBody renders the buttons inside
// their labeled sections via the `only` prop. The fixed button order splits cleanly at the
// section boundaries (…goals | reviews | daysOff), so the overall button order across a
// card is unchanged from the flat-footer era.
export const OPERATIONAL_ACTIONS: readonly ButtonKey[] = [
  "provide",
  "ask",
  "request",
  "newOneOnOne",
  "feedbacks",
  "oneOnOnes",
  "goals",
];
export const PERFORMANCE_ACTIONS: readonly ButtonKey[] = ["reviews"];
export const DAYS_OFF_ACTIONS: readonly ButtonKey[] = ["daysOff"];

// Whether any button of `subset` would render under these props — the card body uses it to
// decide whether a section (or its buttons row) exists at all. Mirrors PersonCardActions'
// render filter: shown by `show` AND labeled in the effective i18n area.
export function hasVisibleActions(
  props: {
    labels: "users" | "teams";
    show: Partial<Record<ButtonKey, boolean>>;
    audit?: boolean;
  },
  subset: readonly ButtonKey[],
): boolean {
  const labelSource = props.audit ? PERSON_CARD_ACTION_LABELS.audit : PERSON_CARD_ACTION_LABELS[props.labels];
  return subset.some((key) => props.show[key] && labelSource[key] != null && hasFeature(FEATURE_OF[key]));
}
