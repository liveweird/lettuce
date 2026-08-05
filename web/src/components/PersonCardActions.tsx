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
import { PERSON_CARD_ACTION_LABELS, type ButtonKey } from "./personCardSupport";

// The per-person action/drill-down buttons shared by the dashboard card grids, the
// user-details card, and the details page's HR-audit block (the checkup-#10 ×4 dedup).
// The differences between the sites are pure data: which buttons show, which i18n area
// labels them (the managers grid speaks `users.*`, the team grids `teams.*`, the audit
// block `users.audit.*` arias), where the create flows return (`back`), and how the
// drill-downs are addressed (`drillFrom`/`drillTeamId`/`drillBack`/`manages`/`audit`).
// Rendered output per call site is identical to the pre-extraction JSX — keep it that
// way: unit and e2e locators key on the aria-labels and texts.

// The label table, section subsets, and visibility predicate live in personCardSupport.ts
// (non-component exports — the Fast Refresh split).
const LABELS = PERSON_CARD_ACTION_LABELS;

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
  /** Restrict to a subset of buttons (the card body's per-section rendering); order unchanged. */
  only?: readonly ButtonKey[];
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
  only,
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
        .filter((key) => show[key] && (only == null || only.includes(key)))
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
