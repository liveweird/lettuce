/* eslint-disable react-refresh/only-export-components */
// A deliberately mixed file (the auth.tsx precedent): the goal value/overdue helpers and their
// small presentational components share one home, at the cost of Fast Refresh for it.
import { Badge, Group, Progress, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalResponse, GoalStatus, GoalType } from "../api/client";
import ReadOnlyField from "../components/ReadOnlyField";
import { todayIsoDate } from "./datetime";

// A goal is overdue only while ACTIVE (a draft has no deadline pressure yet, a closed goal is a
// record) — ISO strings compare chronologically, so a plain string compare suffices.
export function isGoalOverdue(status: GoalStatus, dueDate: string): boolean {
  return status === "ACTIVE" && dueDate < todayIsoDate();
}

// The "past its due date" pill next to due-date renderings (table cell, view/edit headers).
// Orange = warning; red stays reserved for errors/destructive actions.
export function OverdueBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color="orange" style={{ minWidth: "max-content" }}>
      {t("goal.overdue")}
    </Badge>
  );
}

// A goal's numeric value rendered for its type: locale-formatted number, "%"-suffixed for
// PERCENTAGE, an em dash for null (a BINARY goal's numeric columns). BINARY progress is the
// achieved flag, rendered by AchievedBadge instead.
export function formatGoalValue(type: GoalType, value: number | null | undefined, locale: string): string {
  if (type === "BINARY" || value == null) return "—";
  const formatted = new Intl.NumberFormat(locale).format(value);
  return type === "PERCENTAGE" ? `${formatted}%` : formatted;
}

// The BINARY goal's current-value pill (green done / yellow not-yet), shared by the table cell
// and the view screen. min-width keeps Mantine from ellipsizing it inside table cells.
export function AchievedBadge({ achieved }: { achieved: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={achieved ? "teal" : "yellow"} style={{ minWidth: "max-content" }}>
      {achieved ? t("goal.achieved") : t("goal.notAchieved")}
    </Badge>
  );
}

// The per-type CURRENT value, compact (table cells): the achieved pill for BINARY, the
// formatted number otherwise. The single home of that type branch. A goal with no recorded
// value yet (v2.8.1: both fields null until the first update) renders the em dash — a null
// achieved is "not set", never the yellow "Not achieved" pill.
export function GoalCurrentValue({
  type,
  currentValue,
  achieved,
  locale,
}: {
  type: GoalType;
  currentValue: number | null | undefined;
  achieved: boolean | null | undefined;
  locale: string;
}) {
  if (type === "BINARY") {
    return achieved == null ? <>—</> : <AchievedBadge achieved={achieved} />;
  }
  return <>{formatGoalValue(type, currentValue, locale)}</>;
}

// The type-specific value block for the read-only document: a progress bar for PERCENTAGE,
// two labeled numbers for NUMBER, the achieved pill for BINARY.
export function GoalValues({ goal, locale }: { goal: GoalResponse; locale: string }) {
  const { t } = useTranslation();
  if (goal.type === "BINARY") {
    return (
      <ReadOnlyField label={t("goal.current")}>
        {/* Null = no value recorded yet (v2.8.1) — never the "Not achieved" pill. */}
        {goal.achieved == null ? (
          <Text size="sm" c="dimmed">
            {t("goal.noValueYet")}
          </Text>
        ) : (
          <AchievedBadge achieved={goal.achieved} />
        )}
      </ReadOnlyField>
    );
  }
  const target = formatGoalValue(goal.type, goal.targetValue, locale);
  const current = formatGoalValue(goal.type, goal.currentValue, locale);
  return (
    <Stack gap="xs">
      <Group gap="xl">
        <ReadOnlyField label={t("goal.target")}>
          <Text size="sm">{target}</Text>
        </ReadOnlyField>
        <ReadOnlyField label={t("goal.current")}>
          <Text size="sm">{goal.currentValue == null ? t("goal.noValueYet") : current}</Text>
        </ReadOnlyField>
      </Group>
      {goal.type === "PERCENTAGE" && goal.currentValue != null && (
        <>
          <Progress
            value={goal.currentValue}
            color={
              goal.targetValue != null && goal.currentValue >= goal.targetValue
                ? "teal"
                : "lettuce"
            }
            aria-label={t("goal.current")}
          />
          <Text size="sm" c="dimmed">
            {t("goal.currentOfTarget", { current, target })}
          </Text>
        </>
      )}
    </Stack>
  );
}
