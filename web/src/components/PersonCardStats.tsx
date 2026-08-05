import { Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatMonthRange, formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import type { PersonCard as PersonCardData } from "../utils/teamRows";
import PerformanceReviewStatusBadge from "./PerformanceReviewStatusBadge";

// A stat line: dimmed label + value (relative phrase with the exact date in the title),
// or a dimmed "never" when there is nothing yet. Wrapping is allowed on purpose (v1.34.0):
// a long value (1:1 date + open-items badge, a review period + status badge) folds to the
// next line inside its column instead of blowing past the card edge.
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

// The career-profile column (v1.32.1): the three dictionary-backed values, no caption and
// deliberately SHORT card-only labels (users.profile.* — v1.32.2); the Edit/Create pickers
// keep the full common.field.* wordings.
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

// The two-column stats layout: relationship stats left, career profile right. A SimpleGrid,
// not a wrapping Group — the split must be deterministic (v1.32.2): with wrap, cards whose
// left column ran wide (peer labels, open-items badges) silently stacked to one column while
// their neighbors kept two.
function StatsColumns({ left, person }: { left: React.ReactNode; person: PersonCardData }) {
  return (
    <SimpleGrid cols={2} spacing="md" verticalSpacing={4}>
      {left}
      <CareerRows person={person} />
    </SimpleGrid>
  );
}

// The career column alone — for cards that carry no relationship stats (the details page's
// self/unrelated card, the subordinates grid at reports-scope "all", where the directional
// stats aren't computed but the career profile is).
export function CareerCardStats({ person }: { person: PersonCardData }) {
  return <CareerRows person={person} />;
}

// The dashboard-card stats block shared by the "My managers" and "My subordinates" grids.
// The labels are deliberately direction-neutral — each card is about the pictured person,
// so "Last 1:1" / "Last feedback" read correctly whichever party ran/provided it.
// `showLastReview` gates the review row to the grids whose rows actually carry the stat
// (view=managed only) — without it a managers-grid card would show a false "never".
export default function PersonCardStats({
  person,
  showLastReview = false,
  showDaysOff = false,
}: {
  person: PersonCardData;
  showLastReview?: boolean;
  /** Gate for the days-off rows (v1.44.0) — set by the subordinates grid only, whose rows
   *  (view=managed) actually carry the stats; a managers-grid card never does. */
  showDaysOff?: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <StatsColumns
      person={person}
      left={
        <Stack gap={4}>
          <StatRow label={t("users.lastOneOnOne")}>
            {person.lastOneOnOneDate != null ? (
              <>
                <Text size="xs" title={formatIsoDate(person.lastOneOnOneDate, i18n.language)}>
                  {formatRelativeTime(new Date(`${person.lastOneOnOneDate}T00:00:00`).getTime(), i18n.language)}
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
          {showDaysOff && (
            <>
              <NextVacationRow person={person} />
              <StatRow label={t("users.daysOffBudgetLeft")}>
                {person.daysOffRemaining != null ? (
                  <Text size="xs">{formatDays(person.daysOffRemaining, i18n.language)}</Text>
                ) : (
                  <NeverText />
                )}
              </StatRow>
            </>
          )}
        </Stack>
      }
    />
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

// The peers-grid variant: no 1:1 row (peers don't run 1:1s with each other) — instead the
// two feedback directions between the caller and the pictured person, plus the next accepted
// vacation (member rows carry it — calendar parity; budgets never appear here).
export function PeerCardStats({ person }: { person: PersonCardData }) {
  const { t } = useTranslation();
  return (
    <StatsColumns
      person={person}
      left={
        <Stack gap={4}>
          <StatRow label={t("users.feedbackFromMe")}>
            <TimeStat at={person.lastFeedbackGivenAt} />
          </StatRow>
          <StatRow label={t("users.feedbackFromThem")}>
            <TimeStat at={person.lastFeedbackReceivedAt} />
          </StatRow>
          <NextVacationRow person={person} />
        </Stack>
      }
    />
  );
}
