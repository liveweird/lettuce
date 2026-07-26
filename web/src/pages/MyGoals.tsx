import { Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import GoalTable from "./GoalTable";

// The nav "My goals" page: every goal set for the caller, across all their managers — the
// unpinned own view, so GoalTable adds its Manager column. Read-only from this side (goals are
// created by managers from the subordinate cards / drill-down).
export default function MyGoals() {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>{t("goal.myGoalsTitle")}</Title>
        <Text size="sm" c="dimmed">
          {t("goal.myGoalsHint")}
        </Text>
      </Stack>

      {/* No backTo: the detail pages already default their return target to /goals. */}
      <GoalTable view="own" />
    </Stack>
  );
}
