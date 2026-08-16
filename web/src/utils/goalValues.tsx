/* eslint-disable react-refresh/only-export-components */
// A deliberately mixed file (the auth.tsx precedent): the goal value/overdue helpers and their
// small presentational components share one home, at the cost of Fast Refresh for it.
import { Badge, Group, Progress, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalResponse, GoalStatus, GoalType } from "../api/goals";
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
// PERCENTAGE, an em dash for null (a PLAN goal's numeric columns). PLAN progress is its
// milestone tally, rendered by GoalCurrentValue / MilestoneList instead.
export function formatGoalValue(type: GoalType, value: number | null | undefined, locale: string): string {
  if (type === "PLAN" || value == null) return "—";
  const formatted = new Intl.NumberFormat(locale).format(value);
  return type === "PERCENTAGE" ? `${formatted}%` : formatted;
}

// The per-type CURRENT value, compact (table cells): the "done / total" milestone tally for
// PLAN (an em dash while a draft has no milestones yet), the formatted number otherwise. The
// single home of that type branch.
export function GoalCurrentValue({
  type,
  currentValue,
  milestonesDone,
  milestonesTotal,
  locale,
}: {
  type: GoalType;
  currentValue: number | null | undefined;
  milestonesDone: number | null | undefined;
  milestonesTotal: number | null | undefined;
  locale: string;
}) {
  if (type === "PLAN") {
    if (!milestonesTotal) return <>—</>;
    return <>{`${milestonesDone ?? 0} / ${milestonesTotal}`}</>;
  }
  return <>{formatGoalValue(type, currentValue, locale)}</>;
}

// The read-only milestone list (view screen + archived documents): a check square per row,
// done rows visibly settled — struck through + dimmed (v2.9.0, the completed-state emphasis).
function MilestoneList({ milestones }: { milestones: GoalResponse["milestones"] }) {
  return (
    <Stack gap={6}>
      {milestones.map((milestone) => (
        <Group key={milestone.id} gap="xs" wrap="nowrap" align="flex-start">
          <Text size="sm" c={milestone.done ? "teal" : "dimmed"} style={{ flexShrink: 0 }} aria-hidden>
            {milestone.done ? "☑" : "☐"}
          </Text>
          <Text
            size="sm"
            c={milestone.done ? "dimmed" : undefined}
            style={{
              textDecoration: milestone.done ? "line-through" : undefined,
              whiteSpace: "pre-wrap",
            }}
          >
            {milestone.description}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

// The type-specific value block for the read-only document: a progress bar for PERCENTAGE,
// two labeled numbers for NUMBER, the milestone list (+ "x of y done") for PLAN.
export function GoalValues({ goal, locale }: { goal: GoalResponse; locale: string }) {
  const { t } = useTranslation();
  if (goal.type === "PLAN") {
    const done = goal.milestones.filter((m) => m.done).length;
    return (
      <ReadOnlyField label={t("goal.milestones")}>
        {goal.milestones.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("goal.noMilestones")}
          </Text>
        ) : (
          <Stack gap="xs">
            <MilestoneList milestones={goal.milestones} />
            <Text size="sm" c="dimmed">
              {t("goal.milestonesDone", { done, total: goal.milestones.length })}
            </Text>
          </Stack>
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
