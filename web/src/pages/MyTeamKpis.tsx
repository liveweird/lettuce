import { Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import { teamKpiCreateLink } from "../utils/teamKpiLinks";
import TeamKpiTable from "./TeamKpiTable";

const TABS = ["own", "managed"] as const;
type TeamKpisTab = (typeof TABS)[number];

function isTeamKpisTab(value: string | null): value is TeamKpisTab {
  return TABS.includes(value as TeamKpisTab);
}

// The nav "Team KPIs" page. Tab "My teams' KPIs" is the unpinned own view — every active or
// archived KPI of the teams the caller belongs to (drafts stay private to the manager+chain).
// Tab "Managed KPIs" (renamed in v2.26.0 — with the Reports scope it also lists KPIs OTHER
// managers set for subtree teams; managers only, the MyGoals gate) is the unpinned managed
// view, every status, with the Creator column, the direct-vs-indirect scope filter, and the
// "New team KPI" entry point. The useIsManager probe stays correct for the subtree scope:
// every manager in anyone's subtree directly manages at least one team.
export default function MyTeamKpis() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;

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
              <Text size="sm" c="dimmed">
                {t("teamKpi.managedKpisHint")}
              </Text>
              <TeamKpiTable view="managed" withReportsScope backTo="/team-kpis?tab=managed" />
              {/* The create entry point sits below the list — the house footer convention
                  (the UserGoals pattern). */}
              <Group justify="flex-end">
                <Button
                  component={RouterLink}
                  to={teamKpiCreateLink(undefined, "/team-kpis?tab=managed")}
                  leftSection={<IconPlus size={16} />}
                >
                  {t("teamKpi.newKpi")}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
