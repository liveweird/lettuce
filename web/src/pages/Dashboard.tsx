import { Stack, Tabs, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import DashboardHero from "../components/DashboardHero";
import { useIsManager } from "../hooks/useIsManager";
import ManagersTable from "./ManagersTable";
import MyTeamsTable from "./MyTeamsTable";
import ReviewsDashboard from "./ReviewsDashboard";
import TeamMembersTable from "./TeamMembersTable";

const TABS = ["managers", "peers", "subordinates", "myTeams", "reviews"] as const;
type DashboardTab = (typeof TABS)[number];

function isDashboardTab(value: string | null): value is DashboardTab {
  return TABS.includes(value as DashboardTab);
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // The reviews tab is the manager's per-period completion view — meaningless for
  // non-managers (their own reviews live under "My performance"), so it renders (and its
  // ?tab=reviews deep link resolves) only for a caller who manages a team (the MyGoals gate).
  const isManager = useIsManager();
  const requestedTab = searchParams.get("tab");
  const activeTab: DashboardTab =
    isDashboardTab(requestedTab) && (requestedTab !== "reviews" || isManager)
      ? requestedTab
      : "managers";

  function selectTab(value: string | null) {
    if (!isDashboardTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("dashboard.title")}</Title>
      <DashboardHero />
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="managers" data-tour="dashboard-managers">
            {t("dashboard.tabs.managers")}
          </Tabs.Tab>
          <Tabs.Tab value="peers" data-tour="dashboard-peers">
            {t("dashboard.tabs.peers")}
          </Tabs.Tab>
          <Tabs.Tab value="subordinates" data-tour="dashboard-subordinates">
            {t("dashboard.tabs.subordinates")}
          </Tabs.Tab>
          <Tabs.Tab value="myTeams" data-tour="dashboard-myTeams">
            {t("dashboard.tabs.myTeams")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="reviews" data-tour="dashboard-reviews">
              {t("dashboard.tabs.reviews")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="managers" pt="md">
          <ManagersTable />
        </Tabs.Panel>
        <Tabs.Panel value="peers" pt="md">
          <TeamMembersTable view="member" emptyMessage={t("dashboard.empty.teammates")} />
        </Tabs.Panel>
        <Tabs.Panel value="subordinates" pt="md">
          <TeamMembersTable view="managed" emptyMessage={t("dashboard.empty.teamMembers")} />
        </Tabs.Panel>
        <Tabs.Panel value="myTeams" pt="md">
          <MyTeamsTable />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="reviews" pt="md">
            <ReviewsDashboard />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
