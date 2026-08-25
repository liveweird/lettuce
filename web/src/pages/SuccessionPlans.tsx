import { Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import { successionPlanCreateLink } from "../utils/successionLinks";
import SuccessionPlanTable from "./SuccessionPlanTable";

const TABS = ["own", "team"] as const;
type SuccessionTab = (typeof TABS)[number];

function isSuccessionTab(value: string | null): value is SuccessionTab {
  return TABS.includes(value as SuccessionTab);
}

/**
 * The nav "Succession plans" page — a manager's tool (the nav leaf is manager-gated; a
 * direct visit by a non-manager just shows an empty own list, the MyGoals-own precedent, so
 * no async redirect race exists). Tab "My plans" holds the caller's own critical-role/seat
 * records; tab "My subordinates' plans" (managers of managers) is the read-only chain view,
 * with the Reports scope widening it from direct report managers to the whole chain.
 */
export default function SuccessionPlans() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("SUCCESSION_PLANS")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: SuccessionTab =
    isSuccessionTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isSuccessionTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("succession.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own">{t("succession.tab.own")}</Tabs.Tab>
          {isManager && <Tabs.Tab value="team">{t("succession.tab.team")}</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("succession.ownHint")}
            </Text>
            <SuccessionPlanTable view="own" backTo="/succession" />
            {/* The create entry point sits below the list — the house footer convention. */}
            {isManager && (
              <Group justify="flex-end">
                <Button
                  component={RouterLink}
                  to={successionPlanCreateLink("/succession")}
                  leftSection={<IconPlus size={16} />}
                >
                  {t("succession.newPlan")}
                </Button>
              </Group>
            )}
          </Stack>
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                {t("succession.teamHint")}
              </Text>
              <SuccessionPlanTable view="team" withReportsScope backTo="/succession?tab=team" />
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
