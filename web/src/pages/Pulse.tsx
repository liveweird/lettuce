import { Stack, Tabs, Title } from "@mantine/core";
import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature, isHr } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import PulseParticipation from "./PulseParticipation";
import PulseResults from "./PulseResults";
import PulseSurvey from "./PulseSurvey";
import PulseTrend from "./PulseTrend";

const TABS = ["survey", "results", "trend", "participation"] as const;
type PulseTab = (typeof TABS)[number];

function isPulseTab(value: string | null): value is PulseTab {
  return TABS.includes(value as PulseTab);
}

/**
 * The nav "Pulse" hub (the MyGoals tab idiom): the caller's current survey, the team results
 * for closed cycles, the multi-scope trend across cycles (v2.11.0), and — for managers and
 * HR — the participation monitor.
 */
export default function Pulse() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = useIsManager();

  // Per-user feature flag: the whole page area is hidden when disabled.
  if (!hasFeature("PULSE_SURVEYS")) return <Navigate to="/" replace />;

  const canMonitor = isManager || isHr();
  const requestedTab = searchParams.get("tab");
  const activeTab: PulseTab =
    isPulseTab(requestedTab) && (requestedTab !== "participation" || canMonitor)
      ? requestedTab
      : "survey";

  function selectTab(value: string | null) {
    if (!isPulseTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("pulse.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="survey" data-tour="pulse-survey">
            {t("pulse.tab.survey")}
          </Tabs.Tab>
          <Tabs.Tab value="results" data-tour="pulse-results">
            {t("pulse.tab.results")}
          </Tabs.Tab>
          <Tabs.Tab value="trend" data-tour="pulse-trend">
            {t("pulse.tab.trend")}
          </Tabs.Tab>
          {canMonitor && (
            <Tabs.Tab value="participation" data-tour="pulse-participation">
              {t("pulse.tab.participation")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="survey" pt="md">
          <PulseSurvey />
        </Tabs.Panel>
        <Tabs.Panel value="results" pt="md">
          <PulseResults />
        </Tabs.Panel>
        <Tabs.Panel value="trend" pt="md">
          <PulseTrend />
        </Tabs.Panel>
        {canMonitor && (
          <Tabs.Panel value="participation" pt="md">
            <PulseParticipation />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
