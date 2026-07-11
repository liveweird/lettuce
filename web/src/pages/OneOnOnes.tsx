import { Button, Group, Stack, Tabs, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, listTeams } from "../api/client";
import OneOnOneTable from "./OneOnOneTable";

const TABS = ["own", "managed", "team"] as const;
type OneOnOneTab = (typeof TABS)[number];

function isOneOnOneTab(value: string | null): value is OneOnOneTab {
  return TABS.includes(value as OneOnOneTab);
}

export default function OneOnOnes() {
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
  const activeTab: OneOnOneTab =
    isOneOnOneTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isOneOnOneTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t("oneOnOne.sectionTitle")}</Title>
        {isManager && (
          <Button
            component={RouterLink}
            to="/one-on-ones/new"
            leftSection={<IconPlus size={16} />}
          >
            {t("oneOnOne.newMeeting")}
          </Button>
        )}
      </Group>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own">{t("oneOnOne.tab.own")}</Tabs.Tab>
          {isManager && <Tabs.Tab value="managed">{t("oneOnOne.tab.managed")}</Tabs.Tab>}
          {isManager && <Tabs.Tab value="team">{t("oneOnOne.tab.team")}</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <OneOnOneTable view="own" />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            <OneOnOneTable view="managed" />
          </Tabs.Panel>
        )}
        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <OneOnOneTable view="team" />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
