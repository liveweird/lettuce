import { Badge, Divider, Group, Text, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";
import { canAudit, hasFeature } from "../api/session";
import { formatIsoDate, formatMonthRangeShort, formatRelativeTime, formatDateTime } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import { pickLocalized, type LocalizedEntry } from "../utils/localized";
import type { PersonCard as PersonCardData } from "../utils/teamRows";
import { STATUS_COLORS as REVIEW_STATUS_COLORS } from "./performanceReviewStatusColors";
import PersonCardActions, { type PersonCardActionsProps } from "./PersonCardActions";
import { StatusDot } from "./StatusPill";
import {
  DAYS_OFF_ACTIONS,
  OPERATIONAL_ACTIONS,
  PERFORMANCE_ACTIONS,
  PROFILE_ACTIONS,
  hasVisibleActions,
  type ButtonKey,
} from "./personCardSupport";
import classes from "./PersonCardStats.module.css";

// A stat line: dimmed label + value (relative phrase with the exact date in the title), or a
// dimmed "never" when there is nothing yet. The two are separate cells of the body grid
// (v1.50.0), so every value in the card lines up in one column. Inside the value cell wrapping
// is allowed by default (v1.34.0): a long value (e.g. 1:1 date + open-items badge) folds to the
// next line instead of blowing past the card edge. A row can opt into `wrap="nowrap"` instead
// (the last-review dot + period, v4.x) when it must stay on one line and shrink/ellipsize its
// text last.
function StatRow({
  label,
  children,
  wrap = "wrap",
  ariaLabel,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  /** `nowrap` for a row whose value must stay on one line (e.g. the last-review dot + period,
   *  where a wrapped pill used to push the period onto its own line — v4.x). */
  wrap?: "wrap" | "nowrap";
  /** Exposes the row's value to assistive tech as one phrase (e.g. "Sep 2026 – Feb 2027,
   *  Published") when the visible content alone doesn't carry the full meaning (a colour dot). */
  ariaLabel?: string;
  /** A hover/focus tooltip on the value — the status name behind a dot that has no label. */
  tooltip?: string;
}) {
  const value = (
    <Group
      gap="xs"
      wrap={wrap}
      className={classes.value}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      // Focusable only when it carries a tooltip, so keyboard users can reach the status name
      // behind the dot too (screen readers already get it from the aria-label).
      tabIndex={tooltip ? 0 : undefined}
    >
      {children}
    </Group>
  );
  return (
    <div className={classes.statRow}>
      <Text size="xs" c="dimmed" className={classes.label}>
        {label}
      </Text>
      {tooltip ? <Tooltip label={tooltip}>{value}</Tooltip> : value}
    </div>
  );
}

// The shared empty state of every stat value: a dimmed "never".
function NeverText() {
  const { t } = useTranslation();
  return (
    <Text size="xs" c="dimmed">
      {t("users.statNever")}
    </Text>
  );
}

// An epoch-ms stat value: relative phrase (exact timestamp in the title), or a dimmed "never".
function TimeStat({ at }: { at: number | null }) {
  const { i18n } = useTranslation();
  return at != null ? (
    <Text size="xs" title={formatDateTime(at, i18n.language)}>
      {formatRelativeTime(at, i18n.language)}
    </Text>
  ) : (
    <NeverText />
  );
}

// One career value: the entry's text in the viewer's language, or a quiet dimmed "Not set"
// (v3.3.0 — the former orange badge made every empty profile read as an error; the admin
// users list keeps the warning cue for the unique id, where it is actionable).
function CareerValue({ entry }: { entry: LocalizedEntry }) {
  const { i18n } = useTranslation();
  return (
    <Text size="xs" style={{ overflowWrap: "break-word" }}>
      {pickLocalized(entry.values, i18n.resolvedLanguage)}
    </Text>
  );
}

function CareerIdentity({ person }: { person: PersonCardData }) {
  const { t } = useTranslation();
  if (
    person.careerPath == null &&
    person.careerSpecialization == null
  ) return null;
  return (
    <div className={classes.identityCareer}>
      {person.careerPath != null && (
        <StatRow label={t("users.profile.path")}>
          <CareerValue entry={person.careerPath} />
        </StatRow>
      )}
      {person.careerSpecialization != null && (
        <StatRow label={t("users.profile.specialization")}>
          <CareerValue entry={person.careerSpecialization} />
        </StatRow>
      )}

    </div>
  );
}

// The last successful login (v3.9.1): relative time + exact-timestamp tooltip via the shared
// TimeStat, or a dimmed "never". Private like seniorityLevel — the server nulls it outside the
// viewer's chain (unless HR/self), so null is ambiguous — the row renders only when a value
// arrived, or where null genuinely means "never logged in" (the manages flavors + self + HR).
function LastLoginRow({ person }: { person: PersonCardData }) {
  const { t } = useTranslation();
  return (
    <StatRow label={t("users.lastLogin")}>
      <TimeStat at={person.lastLoginAt} />
    </StatRow>
  );
}

// The next accepted vacation (v1.44.0): its start date, or a dimmed "none planned". Shared by
// the subordinate cards and the peer cards (teammates see accepted absences via the calendar).
function NextVacationRow({ person }: { person: PersonCardData }) {
  const { t, i18n } = useTranslation();
  return (
    <StatRow label={t("users.nextVacation")}>
      {person.nextVacationStart != null ? (
        <Text size="xs">{formatIsoDate(person.nextVacationStart, i18n.language)}</Text>
      ) : (
        <Text size="xs" c="dimmed">
          {t("users.noVacationPlanned")}
        </Text>
      )}
    </StatRow>
  );
}

// The last authored review's period + status (v1.34.0). The period alone can outgrow the two
// column card body (e.g. "Sep 2026 – Feb 2027" plus a "Published" pill needs ~209px at 1440px,
// more in Polish), so the status rides a colour dot — same hue map as
// PerformanceReviewStatusBadge, never duplicated — instead of a second pill, with the status
// name in a Tooltip and an aria-label on the group so assistive tech still gets both parts
// ("Sep 2026 – Feb 2027, Published"). The row never wraps: the dot never shrinks, the period
// text ellipsizes as a last resort (v4.x, checkup card-review-dot-pyramid-order).
function LastReviewValue({
  status,
  startMonth,
  endMonth,
}: {
  status: PerformanceReviewStatus;
  startMonth: string;
  endMonth: string;
}) {
  const { t, i18n } = useTranslation();
  const period = formatMonthRangeShort(startMonth, endMonth, i18n.language);
  const statusLabel = t(`performanceReview.status.${status}`);
  return (
    <StatRow
      label={t("users.lastReview")}
      wrap="nowrap"
      ariaLabel={`${period}, ${statusLabel}`}
      tooltip={statusLabel}
    >
      <StatusDot color={REVIEW_STATUS_COLORS[status]} style={{ flexShrink: 0 }} />
      <Text size="xs" truncate style={{ minWidth: 0 }}>
        {period}
      </Text>
    </StatRow>
  );
}

// One labeled card section (v1.46.0): a thin divider whose small dimmed caption names the
// group, then the group's stat rows (and, in the `buttons` variant, its action row) in the
// section's own label/value grid (v3.4.0 — the v1.50.0 card-wide grid gave way to the
// two-column body; see PersonCardStats.module.css).
function Section({ label, children, summary = false }: { label: string; children: React.ReactNode; summary?: boolean }) {
  return (
    <div className={`${classes.section}${summary ? ` ${classes.summary}` : ""}`}>
      <Divider label={label} labelPosition="left" className={classes.divider} />
      <div className={classes.rows}>{children}</div>
    </div>
  );
}

// The Collaboration section's stat rows: the directional 1:1 + feedback + active-goals
// rows (manager/subordinate flavors) or the peer flavor's two feedback directions.
function CollaborationRows({
  person,
  directional,
  peer,
  canOneOnOne,
  canFeedback,
  canGoals,
}: {
  person: PersonCardData;
  directional: boolean;
  peer: boolean;
  canOneOnOne: boolean;
  canFeedback: boolean;
  canGoals: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {directional && canOneOnOne && (
        <StatRow label={t("users.lastOneOnOne")}>
          {person.lastOneOnOneDate != null ? (
            <>
              <Text size="xs" title={formatIsoDate(person.lastOneOnOneDate, i18n.language)}>
                {formatRelativeTime(
                  new Date(`${person.lastOneOnOneDate}T00:00:00`).getTime(),
                  i18n.language,
                )}
              </Text>
              <Badge
                size="sm"
                variant="light"
                color={(person.lastOneOnOneOpenItems ?? 0) > 0 ? "yellow" : "teal"}
                style={{ minWidth: "max-content" }}
              >
                {t("users.openItemsBadge", { count: person.lastOneOnOneOpenItems ?? 0 })}
              </Badge>
            </>
          ) : (
            <NeverText />
          )}
        </StatRow>
      )}
      {directional && canFeedback && (
        <StatRow label={t("users.lastFeedback")}>
          <TimeStat at={person.lastFeedbackAt} />
        </StatRow>
      )}
      {directional && canGoals && (
        <StatRow label={t("users.activeGoals")}>
          <Badge
            size="sm"
            variant="light"
            color={(person.activeGoalCount ?? 0) > 0 ? "teal" : "gray"}
            style={{ minWidth: "max-content" }}
          >
            {person.activeGoalCount ?? 0}
          </Badge>
        </StatRow>
      )}
      {peer && canFeedback && (
        <>
          <StatRow label={t("users.feedbackFromMe")}>
            <TimeStat at={person.lastFeedbackGivenAt} />
          </StatRow>
          <StatRow label={t("users.feedbackFromThem")}>
            <TimeStat at={person.lastFeedbackReceivedAt} />
          </StatRow>
        </>
      )}
    </>
  );
}

// Which relationship stats the Collaboration section shows: `manager`/`subordinate` are the
// directional 1:1 + feedback + active-goals rows (labels deliberately direction-neutral —
// each card is about the pictured person, so "Last 1:1" / "Last feedback" read correctly
// whichever party ran/provided it), `peer` the two feedback directions, `none` no rows
// (the details page's self/unrelated card, the subordinates grid at reports-scope "all",
// where the directional stats aren't computed).
export type PersonCardStatsVariant = "manager" | "subordinate" | "peer" | "none";

// Shared relationship facts and actions. v5 dashboard cards lead with collaboration and
// review facts, then disclose profile/leave details; detail pages keep those sections open.
// Every row remains gated by the existing relationship, returned data and feature flags.
export default function PersonCardBody({
  person,
  stats,
  showLastReview = false,
  showDaysOff = false,
  showLastLogin = false,
  successionReviewedAt,
  actions,
  actionsVariant = "buttons",
}: {
  person: PersonCardData;
  stats: PersonCardStatsVariant;
  /** Kept for call-site compatibility; null career values are omitted because they may be private. */
  showSeniorityWhenUnset?: boolean;
  showLastReview?: boolean;
  /** Gate for the budget row (v1.44.0) — subordinate flavors only; peers get vacation-only. */
  showDaysOff?: boolean;
  /** The viewer manages (or is) this person: a null last-login renders as "never" (v3.9.1,
   *  mirrors showSeniorityWhenUnset — null is otherwise ambiguous between hidden and never). */
  showLastLogin?: boolean;
  /** The viewer's own OPEN plan's reviewed stamp for this person (v2.47.2) — present exactly
   *  when the Succession-plan button shows (both derive from the useOwnSuccessionPlans map). */
  successionReviewedAt?: number;
  /** The card's buttons, rendered inside their sections; undefined = none (the self card). */
  actions?: PersonCardActionsProps;
  /** `icons` (v3.4.0, the dashboard grids): the sections hold stats only and every action
   *  sits in one footer with labelled topic menus; `buttons` keeps per-section rows. */
  actionsVariant?: "buttons" | "icons";
}) {
  const { t, i18n } = useTranslation();

  const sectionActions = actionsVariant === "buttons" && actions != null;
  const actionsRow = (subset: readonly ButtonKey[]) =>
    sectionActions && hasVisibleActions(actions, subset) ? (
      <Group gap="xs" wrap="wrap" mt={4} className={classes.actions}>
        <PersonCardActions {...actions} only={subset} />
      </Group>
    ) : null;

  // Per-user feature flags (v1.53.0): stat rows gate on the VIEWER's flags (caller-only
  // semantics), like the buttons — a disabled feature drops its rows, and a section without
  // surviving rows or buttons drops entirely. Profile always renders, so a card never goes
  // empty. hasVisibleActions is already feature-aware, so the action-side gates come free.
  const canFeedback = hasFeature("FEEDBACKS");
  const canOneOnOne = hasFeature("ONE_ON_ONES");
  const canGoals = hasFeature("GOALS");
  const canReviews = hasFeature("PERFORMANCE_REVIEWS");
  const canDaysOff = hasFeature("DAYS_OFF");

  const directional = stats === "manager" || stats === "subordinate";
  const showCollaboration =
    (directional && (canOneOnOne || canFeedback || canGoals)) ||
    (stats === "peer" && canFeedback) ||
    (sectionActions && hasVisibleActions(actions, OPERATIONAL_ACTIONS));
  const showPerformance =
    (showLastReview && canReviews) || (sectionActions && hasVisibleActions(actions, PERFORMANCE_ACTIONS));
  const showVacation = (stats === "peer" || showDaysOff) && canDaysOff;
  const showDaysOffSection = showVacation || (sectionActions && hasVisibleActions(actions, DAYS_OFF_ACTIONS));
  const showSecondaryProfile =
    person.seniorityLevel != null ||
    person.lastLoginAt != null ||
    showLastLogin ||
    canAudit() ||
    successionReviewedAt != null ||
    (sectionActions && hasVisibleActions(actions, PROFILE_ACTIONS));
  // Dashboard cards lead with collaboration. Secondary facts stay reachable through a
  // native keyboard-operable disclosure; detail cards keep every section expanded.
  const secondary = (
    <div className={classes.secondary}>
      {showSecondaryProfile && <Section label={t("users.section.profile")}>
      {person.seniorityLevel != null && (
        <StatRow label={t("users.profile.seniority")}>
          <CareerValue entry={person.seniorityLevel} />
        </StatRow>
      )}
        {(person.lastLoginAt != null || showLastLogin || canAudit()) && (
          <LastLoginRow person={person} />
        )}
        {successionReviewedAt != null && (
          <StatRow label={t("users.successionReviewed")}>
            <TimeStat at={successionReviewedAt} />
          </StatRow>
        )}
        {/* The career-progression drill-down (v2.15.0) — the profile's own button row. */}
        {actionsRow(PROFILE_ACTIONS)}
      </Section>}
      {showDaysOffSection && (
        <Section label={t("users.section.daysOff")}>
          {showVacation && <NextVacationRow person={person} />}
          {showDaysOff && (
            <StatRow label={t("users.daysOffBudgetLeft")}>
              {person.daysOffRemaining != null ? (
                <Text size="xs">{formatDays(person.daysOffRemaining, i18n.language)}</Text>
              ) : (
                <NeverText />
              )}
            </StatRow>
          )}
          {actionsRow(DAYS_OFF_ACTIONS)}
        </Section>
      )}
    </div>
  );
  return (
    <div className={classes.body}>
      <CareerIdentity person={person} />
      {showCollaboration && (
        <Section label={t("users.section.collaboration")} summary>
          <CollaborationRows
            person={person}
            directional={directional}
            peer={stats === "peer"}
            canOneOnOne={canOneOnOne}
            canFeedback={canFeedback}
            canGoals={canGoals}
          />
          {actionsRow(OPERATIONAL_ACTIONS)}
        </Section>
      )}
      {showPerformance && (
        <Section label={t("users.section.performance")}>
          {showLastReview &&
            (person.lastReviewId != null &&
            person.lastReviewStatus != null &&
            person.lastReviewPeriodStartMonth != null &&
            person.lastReviewPeriodEndMonth != null ? (
              <LastReviewValue
                status={person.lastReviewStatus}
                startMonth={person.lastReviewPeriodStartMonth}
                endMonth={person.lastReviewPeriodEndMonth}
              />
            ) : (
              <StatRow label={t("users.lastReview")}>
                <NeverText />
              </StatRow>
            ))}
          {actionsRow(PERFORMANCE_ACTIONS)}
        </Section>
      )}
      {actionsVariant === "icons" && showCollaboration ? (
        <details className={classes.disclosure}>
          <summary aria-label={t(showDaysOffSection ? "users.profileAndLeaveDetailsFor" : "users.profileDetailsFor", { name: person.name })}>
            {t(showDaysOffSection ? "users.profileAndLeaveDetails" : "users.profileDetails")}
          </summary>
          {secondary}
        </details>
      ) : secondary}
      {actionsVariant === "icons" && actions != null && (
        <div className={classes.footer}>
          <PersonCardActions {...actions} variant="icons" />
        </div>
      )}
    </div>
  );
}
