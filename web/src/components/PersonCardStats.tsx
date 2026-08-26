import { Badge, Divider, Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { canAudit, hasFeature } from "../api/session";
import { formatIsoDate, formatMonthRange, formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import { pickLocalized, type LocalizedEntry } from "../utils/localized";
import type { PersonCard as PersonCardData } from "../utils/teamRows";
import PerformanceReviewStatusBadge from "./PerformanceReviewStatusBadge";
import PersonCardActions, { type PersonCardActionsProps } from "./PersonCardActions";
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
// is still allowed on purpose (v1.34.0): a long value (1:1 date + open-items badge, a review
// period + status badge) folds to the next line instead of blowing past the card edge.
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <Text size="xs" c="dimmed" className={classes.label}>
        {label}
      </Text>
      <Group gap="xs" wrap="wrap" className={classes.value}>
        {children}
      </Group>
    </>
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
    <Text size="xs" title={formatTimestamp(at)}>
      {formatRelativeTime(at, i18n.language)}
    </Text>
  ) : (
    <NeverText />
  );
}

// One career value: the entry's text in the viewer's language, or the orange "Not set"
// badge — orange = warning (the missing state is legitimate but should be acted on),
// consistent with the edit form.
function CareerValue({ entry }: { entry: LocalizedEntry | null }) {
  const { t, i18n } = useTranslation();
  return entry ? (
    <Text size="xs" truncate>
      {pickLocalized(entry.values, i18n.resolvedLanguage)}
    </Text>
  ) : (
    <Badge size="sm" variant="light" color="orange" style={{ minWidth: "max-content" }}>
      {t("users.profile.missingBadge")}
    </Badge>
  );
}

// The career-profile rows (v1.32.1): the dictionary-backed values, with deliberately
// SHORT card-only labels (users.profile.* — v1.32.2); the Edit/Create pickers keep the full
// common.field.* wordings. Seniority is private (v2.25.0): the server nulls it outside the
// viewer's chain (unless HR/self), so null is ambiguous — the row renders only when a value
// arrived, or where null genuinely means "unset" (the manages flavors + HR viewers), where
// the orange "Not set" cue stays truthful.
function CareerRows({
  person,
  showSeniorityWhenUnset,
}: {
  person: PersonCardData;
  showSeniorityWhenUnset: boolean;
}) {
  const { t } = useTranslation();
  const showSeniority = person.seniorityLevel != null || showSeniorityWhenUnset || canAudit();
  return (
    <>
      <StatRow label={t("users.profile.path")}>
        <CareerValue entry={person.careerPath} />
      </StatRow>
      <StatRow label={t("users.profile.specialization")}>
        <CareerValue entry={person.careerSpecialization} />
      </StatRow>
      {showSeniority && (
        <StatRow label={t("users.profile.seniority")}>
          <CareerValue entry={person.seniorityLevel} />
        </StatRow>
      )}
    </>
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

// One labeled card section (v1.46.0): a thin divider whose small dimmed caption names the
// group, then the group's stat rows and/or action buttons. It renders as a fragment, not a
// wrapper (v1.50.0) — the rows must stay direct children of the body grid for their labels
// and values to share one column split with every other section's.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <Divider label={label} labelPosition="left" className={classes.divider} />
      {children}
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

// The card body (v1.46.0): the information regrouped into labeled sections, each pairing
// its read-only stats with its related buttons — Profile (career), Collaboration (1:1 +
// feedback + goals, with the create/drill-down buttons), Performance (last review + the
// reviews drill-down), Days off (next vacation + budget + the days-off drill-down). This
// replaced the two-column stats/career split and the flat footer button row. Everything is
// laid out by ONE label/value grid (v1.50.0, PersonCardStats.module.css) — sections are
// fragments inside it, so all values line up in a single column card-wide, and the dividers
// and button rows span both tracks. A section renders only when it has content for this
// flavor; stat gates stay data-driven:
// `showLastReview`/`showDaysOff` are set only where the rows actually carry the stats
// (view=managed — the subordinate flavors), never where "never" would just be noise.
export default function PersonCardBody({
  person,
  stats,
  showSeniorityWhenUnset = false,
  showLastReview = false,
  showDaysOff = false,
  successionReviewedAt,
  actions,
}: {
  person: PersonCardData;
  stats: PersonCardStatsVariant;
  /** The viewer manages (or is) this person: a null seniority renders as "Not set" (v2.25.0). */
  showSeniorityWhenUnset?: boolean;
  showLastReview?: boolean;
  /** Gate for the budget row (v1.44.0) — subordinate flavors only; peers get vacation-only. */
  showDaysOff?: boolean;
  /** The viewer's own OPEN plan's reviewed stamp for this person (v2.47.2) — present exactly
   *  when the Succession-plan button shows (both derive from the useOwnSuccessionPlans map). */
  successionReviewedAt?: number;
  /** The card's buttons, rendered inside their sections; undefined = none (the self card). */
  actions?: PersonCardActionsProps;
}) {
  const { t, i18n } = useTranslation();

  const actionsRow = (subset: readonly ButtonKey[]) =>
    actions != null && hasVisibleActions(actions, subset) ? (
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
    (actions != null && hasVisibleActions(actions, OPERATIONAL_ACTIONS));
  const showPerformance =
    (showLastReview && canReviews) || (actions != null && hasVisibleActions(actions, PERFORMANCE_ACTIONS));
  const showVacation = (stats === "peer" || showDaysOff) && canDaysOff;
  const showDaysOffSection =
    showVacation || (actions != null && hasVisibleActions(actions, DAYS_OFF_ACTIONS));

  return (
    <div className={classes.body}>
      <Section label={t("users.section.profile")}>
        <CareerRows person={person} showSeniorityWhenUnset={showSeniorityWhenUnset} />
        {successionReviewedAt != null && (
          <StatRow label={t("users.successionReviewed")}>
            <TimeStat at={successionReviewedAt} />
          </StatRow>
        )}
        {/* The career-progression drill-down (v2.15.0) — the profile's own button row. */}
        {actionsRow(PROFILE_ACTIONS)}
      </Section>

      {showCollaboration && (
        <Section label={t("users.section.collaboration")}>
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
          {stats === "peer" && canFeedback && (
            <>
              <StatRow label={t("users.feedbackFromMe")}>
                <TimeStat at={person.lastFeedbackGivenAt} />
              </StatRow>
              <StatRow label={t("users.feedbackFromThem")}>
                <TimeStat at={person.lastFeedbackReceivedAt} />
              </StatRow>
            </>
          )}
          {actionsRow(OPERATIONAL_ACTIONS)}
        </Section>
      )}

      {showPerformance && (
        <Section label={t("users.section.performance")}>
          {showLastReview && (
            <StatRow label={t("users.lastReview")}>
              {person.lastReviewId != null &&
              person.lastReviewStatus != null &&
              person.lastReviewPeriodStartMonth != null &&
              person.lastReviewPeriodEndMonth != null ? (
                <>
                  <Text size="xs">
                    {formatMonthRange(
                      person.lastReviewPeriodStartMonth,
                      person.lastReviewPeriodEndMonth,
                      i18n.language,
                    )}
                  </Text>
                  <PerformanceReviewStatusBadge status={person.lastReviewStatus} size="sm" />
                </>
              ) : (
                <NeverText />
              )}
            </StatRow>
          )}
          {actionsRow(PERFORMANCE_ACTIONS)}
        </Section>
      )}

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
}
