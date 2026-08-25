import { Button, Menu } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  IconBeach,
  IconCalendarEvent,
  IconChevronDown,
  IconClipboardText,
  IconMessageCircle,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconNotebook,
  IconPlus,
  IconStairsUp,
  IconTargetArrow,
  IconUserPlus,
  IconUserShield,
} from "@tabler/icons-react";
import {
  feedbackAskLink,
  feedbackProvideLink,
  feedbackRequestLink,
  userFeedbacksLink,
} from "../utils/feedbackLinks";
import { userCareerLink } from "../utils/careerLinks";
import { userDaysOffLink } from "../utils/daysOffLinks";
import { userImpactLogLink } from "../utils/impactLogLinks";
import { userGoalsLink } from "../utils/goalLinks";
import { oneOnOneCreateLink, userOneOnOnesLink } from "../utils/oneOnOneLinks";
import { userPerformanceReviewsLink } from "../utils/performanceReviewLinks";
import { userSuccessionLink } from "../utils/successionLinks";
import { hasFeature } from "../api/session";
import {
  ACTION_GROUPS,
  FEATURE_OF,
  PERSON_CARD_ACTION_LABELS,
  type ActionGroupId,
  type ButtonKey,
} from "./personCardSupport";

// The per-person action/drill-down buttons shared by the dashboard card grids, the
// user-details card, and the details page's HR-audit block (the checkup-#10 ×4 dedup).
// The differences between the sites are pure data: which buttons show, which i18n area
// labels them (the managers grid speaks `users.*`, the team grids `teams.*`, the audit
// block `users.audit.*` arias), where the create flows return (`back`), and how the
// drill-downs are addressed (`drillFrom`/`drillTeamId`/`drillBack`/`manages`/`audit`).
// Since v1.51.0 the feedback and 1:1 actions collapse behind topic dropdowns (the
// FeedbackActionsMenu idiom) whenever a group has ≥2 visible members — see ACTION_GROUPS
// in personCardSupport.ts. Grouping never touches the per-action aria-labels (only the
// role changes, link → menuitem, when a dropdown forms) — keep them stable: unit and e2e
// locators key on the aria-labels and texts.

// The label table, section subsets, and visibility predicate live in personCardSupport.ts
// (non-component exports — the Fast Refresh split).
const LABELS = PERSON_CARD_ACTION_LABELS;

const ICONS: Record<ButtonKey, React.ReactNode> = {
  career: <IconStairsUp size={14} />,
  provide: <IconMessagePlus size={14} />,
  ask: <IconMessageQuestion size={14} />,
  request: <IconUserPlus size={14} />,
  newOneOnOne: <IconPlus size={14} />,
  feedbacks: <IconMessages size={14} />,
  oneOnOnes: <IconCalendarEvent size={14} />,
  goals: <IconTargetArrow size={14} />,
  reviews: <IconClipboardText size={14} />,
  daysOff: <IconBeach size={14} />,
  impactLog: <IconNotebook size={14} />,
  succession: <IconUserShield size={14} />,
};

// The create flows (Provide/Ask/Request/New 1:1) are ACTIONS — light variant; the
// per-person drill-downs are navigation — subtle variant (the pre-extraction convention).
const ACTION_KEYS: ReadonlySet<ButtonKey> = new Set(["provide", "ask", "request", "newOneOnOne"]);

// The dropdown triggers are light: a ≥2 group always contains a create action (the only
// navigation member of either group is its list drill-down).
const GROUP_ICONS: Record<ActionGroupId, React.ReactNode> = {
  feedback: <IconMessageCircle size={14} />,
  oneOnOne: <IconCalendarEvent size={14} />,
};

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
    career: userCareerLink(userId, name, drillFrom ?? "managers", drillTeamId, drillOpts),
    provide: feedbackProvideLink(userId, back),
    ask: feedbackAskLink(userId, back),
    request: feedbackRequestLink(userId, back),
    newOneOnOne: oneOnOneCreateLink(userId, back),
    feedbacks: userFeedbacksLink(userId, name, drillFrom, drillTeamId, undefined, audit, drillOpts),
    oneOnOnes: userOneOnOnesLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    goals: userGoalsLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    reviews: userPerformanceReviewsLink(userId, name, drillFrom ?? "managers", drillTeamId, audit, drillOpts),
    daysOff: userDaysOffLink(userId, name, drillFrom ?? "details", drillTeamId, audit, drillOpts),
    impactLog: userImpactLogLink(userId, name, drillFrom ?? "details", drillTeamId, audit, drillOpts),
    succession: userSuccessionLink(userId, name, drillFrom ?? "details", drillTeamId, audit, drillOpts),
  };

  const labelSource = audit ? LABELS.audit : LABELS[labels];

  // The feature check gates on the VIEWER's flags (v1.53.0, caller-only semantics) — it must
  // stay in lockstep with hasVisibleActions in personCardSupport.ts.
  const visible = (Object.keys(ICONS) as ButtonKey[]).filter((key) => {
    const feature = FEATURE_OF[key];
    return (
      show[key] &&
      (only == null || only.includes(key)) &&
      labelSource[key] != null &&
      (feature == null || hasFeature(feature))
    );
  });

  const plainButton = (key: ButtonKey) => {
    const label = labelSource[key]!;
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
  };

  const groupedKeys = new Set<ButtonKey>(ACTION_GROUPS.flatMap((group) => group.keys));

  return (
    <>
      {ACTION_GROUPS.map((group) => {
        const members = group.keys.filter((key) => visible.includes(key));
        if (members.length === 0) return null;
        // A dropdown only forms over ≥2 actions AND a flavor that labels the trigger (the
        // audit flavor never does); anything less renders the plain button(s) as always.
        const groupLabel = audit ? undefined : group.label[labels];
        if (members.length < 2 || groupLabel == null) return members.map(plainButton);
        return (
          <Menu key={group.id} position="bottom-start" withinPortal>
            <Menu.Target>
              <Button
                variant="light"
                size="xs"
                leftSection={GROUP_ICONS[group.id]}
                rightSection={<IconChevronDown size={14} />}
                aria-label={t(groupLabel.aria, { name })}
              >
                {t(groupLabel.text)}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {members.map((key) => {
                const label = labelSource[key]!;
                return (
                  <Menu.Item
                    key={key}
                    component={RouterLink}
                    to={links[key]!}
                    leftSection={ICONS[key]}
                    aria-label={t(label.aria, { name })}
                  >
                    {t(label.text)}
                  </Menu.Item>
                );
              })}
            </Menu.Dropdown>
          </Menu>
        );
      })}
      {visible.filter((key) => !groupedKeys.has(key)).map(plainButton)}
    </>
  );
}
