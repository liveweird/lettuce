import { Button } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  IconBeach,
  IconCalendarEvent,
  IconClipboardText,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconPlus,
  IconTargetArrow,
  IconUserPlus,
} from "@tabler/icons-react";
import {
  feedbackAskLink,
  feedbackProvideLink,
  feedbackRequestLink,
  userFeedbacksLink,
} from "../utils/feedbackLinks";
import { userDaysOffLink } from "../utils/daysOffLinks";
import { userGoalsLink } from "../utils/goalLinks";
import { oneOnOneCreateLink, userOneOnOnesLink } from "../utils/oneOnOneLinks";
import { userPerformanceReviewsLink } from "../utils/performanceReviewLinks";

// The per-person action/drill-down buttons shared by the dashboard card grids, the
// user-details card, and the details page's HR-audit block (the checkup-#10 ×4 dedup).
// The differences between the sites are pure data: which buttons show, which i18n area
// labels them (the managers grid speaks `users.*`, the team grids `teams.*`, the audit
// block `users.audit.*` arias), where the create flows return (`back`), and how the
// drill-downs are addressed (`drillFrom`/`drillTeamId`/`drillBack`/`manages`/`audit`).
// Rendered output per call site is identical to the pre-extraction JSX — keep it that
// way: unit and e2e locators key on the aria-labels and texts.

type ButtonKey =
  | "provide"
  | "ask"
  | "request"
  | "newOneOnOne"
  | "feedbacks"
  | "oneOnOnes"
  | "goals"
  | "reviews"
  | "daysOff";

type LabelPair = { aria: string; text: string };

const LABELS: Record<"users" | "teams" | "audit", Partial<Record<ButtonKey, LabelPair>>> = {
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

const ICONS: Record<ButtonKey, React.ReactNode> = {
  provide: <IconMessagePlus size={14} />,
  ask: <IconMessageQuestion size={14} />,
  request: <IconUserPlus size={14} />,
  newOneOnOne: <IconPlus size={14} />,
  feedbacks: <IconMessages size={14} />,
  oneOnOnes: <IconCalendarEvent size={14} />,
  goals: <IconTargetArrow size={14} />,
  reviews: <IconClipboardText size={14} />,
  daysOff: <IconBeach size={14} />,
};

// The create flows (Provide/Ask/Request/New 1:1) are ACTIONS — light variant; the
// per-person drill-downs are navigation — subtle variant (the pre-extraction convention).
const ACTION_KEYS: ReadonlySet<ButtonKey> = new Set(["provide", "ask", "request", "newOneOnOne"]);

export type PersonCardActionsProps = {
  userId: number;
  name: string;
  /** i18n area for the button labels: the managers-grid flavor speaks `users.*`, the rest `teams.*`. */
  labels: "users" | "teams";
  /** Which buttons render, in the fixed order above. */
  show: Partial<Record<ButtonKey, boolean>>;
  /** Where the create flows' Cancel/save returns (threaded as `back=`). */
  back?: string;
  /** The drill-downs' `from` origin. `feedbacks` omits it when unset (its resolver defaults). */
  drillFrom?: string;
  drillTeamId?: number;
  /** Explicit drill-down return URL (`back=` override) — the details-page round-trip. */
  drillBack?: string;
  /** The caller manages this person: drill-downs keep their manager-only affordances. */
  manages?: boolean;
  /** The HR-audit flavor: `mode=audit` drill-downs with `users.audit.*` aria-labels. */
  audit?: boolean;
};

export default function PersonCardActions({
  userId,
  name,
  labels,
  show,
  back,
  drillFrom,
  drillTeamId,
  drillBack,
  manages,
  audit,
}: PersonCardActionsProps) {
  const { t } = useTranslation();
  const drillOpts = { back: drillBack, manages };

  const links: Partial<Record<ButtonKey, string>> = {
    provide: feedbackProvideLink(userId, name, back),
    ask: feedbackAskLink(userId, name, back),
    request: feedbackRequestLink(userId, name, back),
    newOneOnOne: oneOnOneCreateLink(userId, name, back),
    feedbacks: userFeedbacksLink(userId, name, drillFrom, drillTeamId, undefined, audit, drillOpts),
    oneOnOnes: userOneOnOnesLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    goals: userGoalsLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    reviews: userPerformanceReviewsLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    daysOff: userDaysOffLink(userId, name, drillFrom ?? "details", drillTeamId, audit, drillOpts),
  };

  const labelSource = audit ? LABELS.audit : LABELS[labels];

  return (
    <>
      {(Object.keys(ICONS) as ButtonKey[])
        .filter((key) => show[key])
        .map((key) => {
          const label = labelSource[key];
          if (!label) return null;
          return (
            <Button
              key={key}
              component={RouterLink}
              to={links[key]!}
              variant={ACTION_KEYS.has(key) ? "light" : "subtle"}
              size="xs"
              leftSection={ICONS[key]}
              aria-label={t(label.aria, { name })}
            >
              {t(label.text)}
            </Button>
          );
        })}
    </>
  );
}
