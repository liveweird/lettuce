import { Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, listTeams } from "../api/client";
import { teamKpiCreateLink } from "../utils/teamKpiLinks";
import TeamKpiTable from "./TeamKpiTable";

const TABS = ["own", "managed"] as const;
type TeamKpisTab = (typeof TABS)[number];

function isTeamKpisTab(value: string | null): value is TeamKpisTab {
  return TABS.includes(value as TeamKpisTab);
}

// The nav "Team KPIs" page. Tab "My teams' KPIs" is the unpinned own view — every active or
// closed KPI of the teams the caller belongs to (drafts stay private to the manager). Tab
// "KPIs I've set" (managers only, the MyGoals gate) is the unpinned managed view across all
// the caller's teams, every status, with the "New team KPI" entry point.
export default function MyTeamKpis() {
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
  const activeTab: TeamKpisTab =
    isTeamKpisTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isTeamKpisTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("teamKpi.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own" data-tour="team-kpis-own">
            {t("teamKpi.tab.own")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="managed" data-tour="team-kpis-managed">
              {t("teamKpi.tab.managed")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("teamKpi.myKpisHint")}
            </Text>
            {/* No backTo: the detail pages already default their return target to /team-kpis. */}
            <TeamKpiTable view="own" />
          </Stack>
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Text size="sm" c="dimmed">
                  {t("teamKpi.managedKpisHint")}
                </Text>
                <Button
                  component={RouterLink}
                  to={teamKpiCreateLink(undefined, undefined, "/team-kpis?tab=managed")}
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                >
                  {t("teamKpi.newKpi")}
                </Button>
              </Group>
              <TeamKpiTable view="managed" backTo="/team-kpis?tab=managed" />
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
