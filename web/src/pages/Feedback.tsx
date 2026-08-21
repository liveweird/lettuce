import { Button, Group, Stack, Tabs, Title } from "@mantine/core";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import FeedbackTable from "./FeedbackTable";

const TABS = ["received", "provided", "team"] as const;
type FeedbackTab = (typeof TABS)[number];

function isFeedbackTab(value: string | null): value is FeedbackTab {
  return TABS.includes(value as FeedbackTab);
}

export default function Feedback() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;

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
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={2}>{t("feedback.sectionTitle")}</Title>
        {/* The create entry point (v2.28.0): /feedback/new with NO subjectId renders the
            subject picker; the created (or drafted) feedback lands on the Provided tab. */}
        <Button
          component={RouterLink}
          to={`/feedback/new?back=${encodeURIComponent("/feedback?tab=provided")}`}
          leftSection={<IconPlus size={16} />}
        >
          {t("feedback.newFeedback")}
        </Button>
      </Group>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="received" data-tour="feedback-received">
            {t("feedback.tab.received")}
          </Tabs.Tab>
          <Tabs.Tab value="provided" data-tour="feedback-provided">
            {t("feedback.tab.provided")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="team" data-tour="feedback-team">
              {t("feedback.tab.team")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="received" pt="md">
          <FeedbackTable view="received" />
        </Tabs.Panel>
        <Tabs.Panel value="provided" pt="md">
          <FeedbackTable view="provided" />
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <FeedbackTable view="team" />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
