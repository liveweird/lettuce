import { Button, Stack, Tabs } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import OneOnOneTable from "./OneOnOneTable";
import PageHeader from "../components/PageHeader";

const TABS = ["own", "managed", "team"] as const;
type OneOnOneTab = (typeof TABS)[number];

function isOneOnOneTab(value: string | null): value is OneOnOneTab {
  return TABS.includes(value as OneOnOneTab);
}

export default function OneOnOnes() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("ONE_ON_ONES")) return <Navigate to="/" replace />;

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
      <PageHeader
        title={t("oneOnOne.sectionTitle")}
        actions={
          isManager && (
            <Button component={RouterLink} to="/one-on-ones/new" leftSection={<IconPlus size={16} />}>
              {t("oneOnOne.newMeeting")}
            </Button>
          )
        }
      />
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          {isManager && (
            <Tabs.Tab value="managed" data-tour="one-on-one-managed">
              {t("oneOnOne.tab.managed")}
            </Tabs.Tab>
          )}
          <Tabs.Tab value="own" data-tour="one-on-one-own">
            {t("oneOnOne.tab.own")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="team" data-tour="one-on-one-team">
              {t("oneOnOne.tab.team")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            <OneOnOneTable view="managed" />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="own" pt="md">
          <OneOnOneTable view="own" />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <OneOnOneTable view="team" />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
