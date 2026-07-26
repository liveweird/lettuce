import { Badge, Group, Progress, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalResponse, GoalType } from "../api/client";
import ReadOnlyField from "../components/ReadOnlyField";

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
    <Badge variant="light" color={achieved ? "green" : "yellow"} style={{ minWidth: "max-content" }}>
      {achieved ? t("goal.achieved") : t("goal.notAchieved")}
    </Badge>
  );
}

// The per-type CURRENT value, compact (table cells): the achieved pill for BINARY, the
// formatted number otherwise. The single home of that type branch.
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
  if (type === "BINARY") return <AchievedBadge achieved={achieved === true} />;
  return <>{formatGoalValue(type, currentValue, locale)}</>;
}

// The type-specific value block for the read-only document: a progress bar for PERCENTAGE,
// two labeled numbers for NUMBER, the achieved pill for BINARY.
export function GoalValues({ goal, locale }: { goal: GoalResponse; locale: string }) {
  const { t } = useTranslation();
  if (goal.type === "BINARY") {
    return (
      <ReadOnlyField label={t("goal.current")}>
        <AchievedBadge achieved={goal.achieved === true} />
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
          <Text size="sm">{current}</Text>
        </ReadOnlyField>
      </Group>
      {goal.type === "PERCENTAGE" && (
        <>
          <Progress
            value={goal.currentValue ?? 0}
            color={
              goal.targetValue != null && (goal.currentValue ?? 0) >= goal.targetValue
                ? "green"
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
