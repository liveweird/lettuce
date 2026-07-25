import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalType } from "../api/client";

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
