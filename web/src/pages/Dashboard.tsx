import { Stack, Tabs, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";
import DashboardHero from "../components/DashboardHero";
import ManagersTable from "./ManagersTable";
import MyTeamsTable from "./MyTeamsTable";
import TeamMembersTable from "./TeamMembersTable";

const TABS = ["managers", "peers", "subordinates", "myTeams"] as const;
type DashboardTab = (typeof TABS)[number];

function isDashboardTab(value: string | null): value is DashboardTab {
  return TABS.includes(value as DashboardTab);
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: DashboardTab = isDashboardTab(requestedTab) ? requestedTab : "managers";

  function selectTab(value: string | null) {
    if (!isDashboardTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  // The reviews tab moved to /performance?tab=managed (v1.45.0) — keep old bookmarks and
  // notification landings working instead of silently falling back to the managers tab.
  if (requestedTab === "reviews") return <Navigate to="/performance?tab=managed" replace />;

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
      </Tabs>
    </Stack>
  );
}
