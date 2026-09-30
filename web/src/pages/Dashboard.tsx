import { Button, Stack, Tabs, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { IconPlus } from "@tabler/icons-react";
import { hasFeature } from "../api/session";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { feedbackCreateLink } from "../utils/feedbackLinks";
import PageHeader from "../components/PageHeader";
import DashboardHero from "../components/DashboardHero";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
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
  const here = useCurrentPath();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  // The last-picked tab is remembered per device (v3.4.0); an explicit ?tab= always wins,
  // and the default stays "managers" (a manager-aware async default would flash).
  const [storedTab, setStoredTab] = useStoredState<DashboardTab>("dashboard.tab", "managers", isOneOf(TABS));
  const activeTab: DashboardTab = isDashboardTab(requestedTab) ? requestedTab : storedTab;

  function selectTab(value: string | null) {
    if (!isDashboardTab(value)) return;
    setStoredTab(value);
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
      <PageHeader title={t("dashboard.title")} description={t("dashboard.description")}
        actions={hasFeature("FEEDBACKS") ? (
          <Button component={RouterLink} to={feedbackCreateLink("/feedback?tab=provided", here)} leftSection={<IconPlus size={16} />}>
            {t("feedback.newFeedback")}
          </Button>
        ) : undefined}
      />
      <DashboardHero />
      <Stack gap={4}>
        <Title order={3}>{t("dashboard.relationships")}</Title>
        <Text size="sm" c="dimmed">{t("dashboard.relationshipsHint")}</Text>
      </Stack>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="managers" data-tour="dashboard-managers">
            {t("dashboard.tabs.managers")}
          </Tabs.Tab>
          <Tabs.Tab value="peers">
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
