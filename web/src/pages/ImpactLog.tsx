import { Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import { impactEntryCreateLink } from "../utils/impactLogLinks";
import ImpactLogTable from "./ImpactLogTable";

const TABS = ["own", "managed"] as const;
type ImpactLogTab = (typeof TABS)[number];

function isImpactLogTab(value: string | null): value is ImpactLogTab {
  return TABS.includes(value as ImpactLogTab);
}

// The nav "Impact log" page. Tab "My journal" is the caller's own accomplishment journal
// (they alone write it). Tab "My subordinates' journals" (managers only) is the read-only
// managed view, with the Reports scope widening it from direct reports to the whole chain.
export default function ImpactLog() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: ImpactLogTab =
    isImpactLogTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isImpactLogTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("impactLog.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own">{t("impactLog.tab.own")}</Tabs.Tab>
          {isManager && <Tabs.Tab value="managed">{t("impactLog.tab.managed")}</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("impactLog.myJournalHint")}
            </Text>
            <ImpactLogTable view="own" />
            {/* The create entry point sits below the list — the house footer convention. */}
            <Group justify="flex-end">
              <Button
                component={RouterLink}
                to={impactEntryCreateLink("/impact-log")}
                leftSection={<IconPlus size={16} />}
              >
                {t("impactLog.newEntry")}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                {t("impactLog.managedHint")}
              </Text>
              <ImpactLogTable
                view="managed"
                withReportsScope
                backTo="/impact-log?tab=managed"
              />
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
