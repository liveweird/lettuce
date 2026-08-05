// The person-card action metadata, split out of PersonCardActions.tsx so that file keeps
// only component exports and stays compatible with React Fast Refresh
// (react-refresh/only-export-components) — the tourSupport.ts idiom.

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

export const PERSON_CARD_ACTION_LABELS: Record<
  "users" | "teams" | "audit",
  Partial<Record<ButtonKey, LabelPair>>
> = {
  users: {
    provide: { aria: "users.provideFeedbackTo", text: "users.provideFeedback" },
    ask: { aria: "users.askForFeedbackFrom", text: "users.askForFeedback" },
    feedbacks: { aria: "users.feedbacksWith", text: "users.feedbacks" },
    oneOnOnes: { aria: "users.oneOnOnesWith", text: "users.oneOnOnes" },
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
  return subset.some((key) => props.show[key] && labelSource[key] != null);
}
