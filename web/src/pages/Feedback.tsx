import { Stack, Tabs, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, listTeams } from "../api/client";
import FeedbackTable from "./FeedbackTable";
import FeedbackTeamTable from "./FeedbackTeamTable";

const TABS = ["received", "provided", "team"] as const;
type FeedbackTab = (typeof TABS)[number];

function isFeedbackTab(value: string | null): value is FeedbackTab {
  return TABS.includes(value as FeedbackTab);
}

export default function Feedback() {
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
  const activeTab: FeedbackTab =
    isFeedbackTab(requestedTab) && (requestedTab !== "team" || isManager)
      ? requestedTab
      : "received";

  function selectTab(value: string | null) {
    if (!isFeedbackTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("feedback.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="received">{t("feedback.tab.received")}</Tabs.Tab>
          <Tabs.Tab value="provided">{t("feedback.tab.provided")}</Tabs.Tab>
          {isManager && <Tabs.Tab value="team">{t("feedback.tab.team")}</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="received" pt="md">
          <FeedbackTable view="received" />
        </Tabs.Panel>
        <Tabs.Panel value="provided" pt="md">
          <FeedbackTable view="provided" />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <FeedbackTeamTable />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
