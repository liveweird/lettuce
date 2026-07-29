import { Stack, Tabs, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, listTeams } from "../api/client";
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
  const userId = getUserId();

  const { data: managedTeams } = useQuery({
    queryKey: ["managedTeams", userId],
    queryFn: () => listTeams({ page: 1, pageSize: 1, managerId: userId! }),
    enabled: userId !== null,
  });
  const isManager = (managedTeams?.total ?? 0) > 0;

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
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
