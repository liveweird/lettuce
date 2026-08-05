import { Badge, Divider, Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatMonthRange, formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import type { PersonCard as PersonCardData } from "../utils/teamRows";
import PerformanceReviewStatusBadge from "./PerformanceReviewStatusBadge";
import PersonCardActions, { type PersonCardActionsProps } from "./PersonCardActions";
import {
  DAYS_OFF_ACTIONS,
  OPERATIONAL_ACTIONS,
  PERFORMANCE_ACTIONS,
  hasVisibleActions,
  type ButtonKey,
} from "./personCardSupport";

// A stat line: dimmed label + value (relative phrase with the exact date in the title),
// or a dimmed "never" when there is nothing yet. Wrapping is allowed on purpose (v1.34.0):
// a long value (1:1 date + open-items badge, a review period + status badge) folds to the
// next line instead of blowing past the card edge.
function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group gap="xs" wrap="wrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {children}
    </Group>
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

// One career value: the entry's plain text, or the orange "Not set" badge — orange = warning
// (the missing state is legitimate but should be acted on), consistent with the edit form.
function CareerValue({ entry }: { entry: { id: number; value: string } | null }) {
  const { t } = useTranslation();
  return entry ? (
    <Text size="xs" truncate>
      {entry.value}
    </Text>
  ) : (
    <Badge size="sm" variant="light" color="orange" style={{ minWidth: "max-content" }}>
      {t("users.profile.missingBadge")}
    </Badge>
  );
}

// The career-profile rows (v1.32.1): the three dictionary-backed values, with deliberately
// SHORT card-only labels (users.profile.* — v1.32.2); the Edit/Create pickers keep the full
// common.field.* wordings.
function CareerRows({ person }: { person: PersonCardData }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <StatRow label={t("users.profile.path")}>
        <CareerValue entry={person.careerPath} />
      </StatRow>
      <StatRow label={t("users.profile.specialization")}>
        <CareerValue entry={person.careerSpecialization} />
      </StatRow>
      <StatRow label={t("users.profile.seniority")}>
        <CareerValue entry={person.seniorityLevel} />
      </StatRow>
    </Stack>
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
// group, then the group's stat rows and/or action buttons.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={4}>
      <Divider label={label} labelPosition="left" />
      {children}
    </Stack>
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
// replaced the two-column stats/career split and the flat footer button row. A section
// renders only when it has content for this flavor; stat gates stay data-driven:
// `showLastReview`/`showDaysOff` are set only where the rows actually carry the stats
// (view=managed — the subordinate flavors), never where "never" would just be noise.
export default function PersonCardBody({
  person,
  stats,
  showLastReview = false,
  showDaysOff = false,
  actions,
}: {
  person: PersonCardData;
  stats: PersonCardStatsVariant;
  showLastReview?: boolean;
  /** Gate for the budget row (v1.44.0) — subordinate flavors only; peers get vacation-only. */
  showDaysOff?: boolean;
  /** The card's buttons, rendered inside their sections; undefined = none (the self card). */
  actions?: PersonCardActionsProps;
}) {
  const { t, i18n } = useTranslation();

  const actionsRow = (subset: readonly ButtonKey[]) =>
    actions != null && hasVisibleActions(actions, subset) ? (
      <Group gap="xs" wrap="wrap" mt={4}>
        <PersonCardActions {...actions} only={subset} />
      </Group>
    ) : null;

  const directional = stats === "manager" || stats === "subordinate";
  const showCollaboration =
    directional || stats === "peer" || (actions != null && hasVisibleActions(actions, OPERATIONAL_ACTIONS));
  const showPerformance =
    showLastReview || (actions != null && hasVisibleActions(actions, PERFORMANCE_ACTIONS));
  const showVacation = stats === "peer" || showDaysOff;
  const showDaysOffSection =
    showVacation || (actions != null && hasVisibleActions(actions, DAYS_OFF_ACTIONS));

  return (
    <Stack gap="sm">
      <Section label={t("users.section.profile")}>
        <CareerRows person={person} />
      </Section>

      {showCollaboration && (
        <Section label={t("users.section.collaboration")}>
          {directional && (
            <>
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
              <StatRow label={t("users.lastFeedback")}>
                <TimeStat at={person.lastFeedbackAt} />
              </StatRow>
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
            </>
          )}
          {stats === "peer" && (
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
    </Stack>
  );
}
