import { Stack, Tabs, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, listCareerPositions } from "../api/client";
import CareerTimeline from "../components/CareerTimeline";
import { useIsManager } from "../hooks/useIsManager";
import CareerPyramid from "./CareerPyramid";

const TABS = ["my", "pyramid"] as const;
type CareerTab = (typeof TABS)[number];

function isCareerTab(value: string | null): value is CareerTab {
  return TABS.includes(value as CareerTab);
}

// "My career" is the caller's own position timeline — the /users/:id/career render, read-only
// (one's managers maintain it). The tab panel is inline here (a query + the shared
// CareerTimeline is all it takes — no separate page component needed).
function MyCareer() {
  const { t } = useTranslation();
  const userId = getUserId();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["careerPositions", userId],
    queryFn: () => listCareerPositions(userId!),
    enabled: userId != null,
  });
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("career.my.hint")}
      </Text>
      <CareerTimeline positions={data} isLoading={isLoading} isError={isError} />
    </Stack>
  );
}

/**
 * The nav "Career" page (v2.16.0), the Performance.tsx two-tab shape: "My career" (everyone)
 * and "Team pyramid" (managers only — the tab simply isn't rendered otherwise, and a
 * ?tab=pyramid deep link falls back to "my"). Deliberately feature-UNGATED like the whole
 * career area (FEATURE_OF.career = null).
 */
export default function Career() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = useIsManager();

  const requestedTab = searchParams.get("tab");
  const activeTab: CareerTab =
    isCareerTab(requestedTab) && (requestedTab === "my" || isManager) ? requestedTab : "my";

  function selectTab(value: string | null) {
    if (!isCareerTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("career.title")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="my" data-tour="career-my">
            {t("career.tab.my")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="pyramid" data-tour="career-pyramid">
              {t("career.tab.pyramid")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="my" pt="md">
          <MyCareer />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="pyramid" pt="md">
            <CareerPyramid />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
