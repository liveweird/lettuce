// The person-card action metadata, split out of PersonCardActions.tsx so that file keeps
// only component exports and stays compatible with React Fast Refresh
// (react-refresh/only-export-components) — the tourSupport.ts idiom.

import type { ParseKeys } from "i18next";
import { hasFeature, type Feature } from "../api/session";

export type ButtonKey =
  | "career"
  | "provide"
  | "ask"
  | "request"
  | "newOneOnOne"
  | "feedbacks"
  | "oneOnOnes"
  | "goals"
  | "reviews"
  | "daysOff"
  | "impactLog"
  | "succession";

export type LabelPair = { aria: ParseKeys; text: ParseKeys };

// The feature each button belongs to (v1.53.0): a button renders only while the VIEWER has
// its feature enabled (caller-only semantics — the flags gate what the session user may do,
// never what the card's person has). Team KPIs never surface as a person-card action.
// `null` (career, v2.15.0) = the ungated users area — the button never gates on a flag.
export const FEATURE_OF: Record<ButtonKey, Feature | null> = {
  career: null,
  provide: "FEEDBACKS",
  ask: "FEEDBACKS",
  request: "FEEDBACKS",
  feedbacks: "FEEDBACKS",
  newOneOnOne: "ONE_ON_ONES",
  oneOnOnes: "ONE_ON_ONES",
  goals: "GOALS",
  reviews: "PERFORMANCE_REVIEWS",
  daysOff: "DAYS_OFF",
  impactLog: "IMPACT_LOG",
  succession: "SUCCESSION_PLANS",
};

export const PERSON_CARD_ACTION_LABELS: Record<
  "users" | "teams" | "audit",
  Partial<Record<ButtonKey, LabelPair>>
> = {
  users: {
    // The career-progression drill-down (v2.15.0) — readable for everyone, so every flavor
    // carries it in its Profile section.
    career: { aria: "users.careerProgressionFor", text: "users.careerProgression" },
    provide: { aria: "users.provideFeedbackTo", text: "users.provideFeedback" },
    ask: { aria: "users.askForFeedbackFrom", text: "users.askForFeedback" },
    // The drill-down texts are "… list" (v1.51.0) — under this flavor they sit inside (or next
    // to) the topic dropdowns; the audit table below keeps the plain nouns.
    feedbacks: { aria: "users.feedbacksWith", text: "users.feedbackList" },
    oneOnOnes: { aria: "users.oneOnOnesWith", text: "users.oneOnOneList" },
    goals: { aria: "users.goalsWith", text: "users.goals" },
  },
  teams: {
    career: { aria: "teams.careerProgressionForAria", text: "teams.careerProgression" },
    provide: { aria: "teams.provideFeedbackToAria", text: "teams.provideFeedback" },
    ask: { aria: "teams.askForFeedbackAria", text: "teams.askForFeedback" },
    request: { aria: "teams.requestFeedbackAboutAria", text: "teams.requestFeedbackFor" },
    newOneOnOne: { aria: "teams.addOneOnOneWithAria", text: "teams.addOneOnOne" },
    feedbacks: { aria: "teams.feedbacksWithAria", text: "teams.feedbacks" },
    oneOnOnes: { aria: "teams.oneOnOnesWithAria", text: "teams.oneOnOnes" },
    goals: { aria: "teams.goalsForAria", text: "teams.goals" },
    reviews: { aria: "teams.performanceReviewsForAria", text: "teams.performanceReviews" },
    // v2.38.0: the manager-side per-report journal drill-down (view=managed pinned to the user).
    impactLog: { aria: "teams.impactLogForAria", text: "teams.impactLog" },
    // v1.44.0: the manager-side per-report days-off drill-down.
    daysOff: { aria: "teams.daysOffForAria", text: "teams.daysOff" },
    // v2.47.0: the viewer's own OPEN plan for this person (pool-gated by the caller — the
    // show flag is set only when useOwnSuccessionPlans has a match, so the href's plan id
    // is always present when the button renders).
    succession: { aria: "teams.successionPlanForAria", text: "teams.successionPlan" },
  },
  audit: {
    feedbacks: { aria: "users.audit.feedbacksAria", text: "users.feedbacks" },
    oneOnOnes: { aria: "users.audit.oneOnOnesAria", text: "users.oneOnOnes" },
    goals: { aria: "users.audit.goalsAria", text: "users.goals" },
    reviews: { aria: "users.audit.performanceReviewsAria", text: "users.performanceReviews" },
    // v1.42.0: days off are per-user, so the auditor drill-down fits (unlike team KPIs).
    daysOff: { aria: "users.audit.daysOffAria", text: "users.daysOff" },
    // v2.36.0: the whole-journal auditor view (view=user server-side, audit-logged).
    impactLog: { aria: "users.audit.impactLogAria", text: "users.impactLog" },
    // v2.42.0: every succession plan the person is a party to (seat or owner). Since
    // v2.47.0 the manages flavors carry the key too (the teams table above) — there it is
    // the viewer's own OPEN plan for the person, linked directly.
    succession: { aria: "users.audit.successionAria", text: "users.successionPlans" },
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
// section boundaries (career | …goals | reviews | daysOff), so the overall button order
// across a card is unchanged from the flat-footer era.
export const PROFILE_ACTIONS: readonly ButtonKey[] = ["career", "succession"];
export const OPERATIONAL_ACTIONS: readonly ButtonKey[] = [
  "provide",
  "ask",
  "request",
  "newOneOnOne",
  "feedbacks",
  "oneOnOnes",
  "goals",
];
export const PERFORMANCE_ACTIONS: readonly ButtonKey[] = ["reviews", "impactLog"];
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
  return subset.some((key) => {
    const feature = FEATURE_OF[key];
    return props.show[key] && labelSource[key] != null && (feature == null || hasFeature(feature));
  });
}
