import { Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/client";
import { useIsManager } from "../hooks/useIsManager";
import { goalCreateLink } from "../utils/goalLinks";
import GoalTable from "./GoalTable";

const TABS = ["own", "managed"] as const;
type GoalsTab = (typeof TABS)[number];

function isGoalsTab(value: string | null): value is GoalsTab {
  return TABS.includes(value as GoalsTab);
}

// The nav "Goals" page. Tab "My goals" is the unpinned own view — every goal set for the
// caller, across all their managers (read-only from this side). Tab "Goals I've set"
// (managers only) is the unpinned managed view across all subordinates, with the Reports
// scope widening it from the caller's own goals to goals set anywhere down their chain.
export default function MyGoals() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("GOALS")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: GoalsTab =
    isGoalsTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isGoalsTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("goal.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own" data-tour="goals-own">
            {t("goal.tab.own")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="managed" data-tour="goals-managed">
              {t("goal.tab.managed")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("goal.myGoalsHint")}
            </Text>
            {/* No backTo: the detail pages already default their return target to /goals. */}
            <GoalTable view="own" />
          </Stack>
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                {t("goal.managedGoalsHint")}
              </Text>
              <GoalTable view="managed" withReportsScope backTo="/goals?tab=managed" />
              {/* The create entry point sits below the list — the house footer convention
                  (the MyTeamKpis/UserGoals pattern); CreateGoal's direct-report picker
                  handles the unprefilled case. */}
              <Group justify="flex-end">
                <Button
                  component={RouterLink}
                  to={goalCreateLink(undefined, undefined, "/goals?tab=managed")}
                  leftSection={<IconPlus size={16} />}
                >
                  {t("goal.newGoal")}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
