import { Stack, Tabs, Text, Title } from "@mantine/core";
import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/client";
import { useIsManager } from "../hooks/useIsManager";
import PerformanceReviewTable from "./PerformanceReviewTable";
import ReviewsDashboard from "./ReviewsDashboard";

const TABS = ["own", "managed"] as const;
type PerformanceTab = (typeof TABS)[number];

function isPerformanceTab(value: string | null): value is PerformanceTab {
  return TABS.includes(value as PerformanceTab);
}

// The nav "Performance" page (v1.45.0 — unified the old "My performance" nav leaf and the
// Dashboard's "Performance reviews" tab into the house own/managed shape). Tab "My performance"
// is the caller's own view — the server serves PUBLISHED only, so a review in progress
// (DRAFT/CALIBRATION) is invisible here until the manager publishes it; no create affordance,
// authoring is the manager's side. Tab "Team's performance" (managers only) is the per-period
// completion dashboard, moved here unchanged from /?tab=reviews.
export default function Performance() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: PerformanceTab =
    isPerformanceTab(requestedTab) && (requestedTab === "own" || isManager) ? requestedTab : "own";

  function selectTab(value: string | null) {
    if (!isPerformanceTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t("performanceReview.sectionTitle")}</Title>
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="own" data-tour="performance-own">
            {t("performanceReview.tab.own")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="managed" data-tour="performance-managed">
              {t("performanceReview.tab.managed")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="own" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("performanceReview.myHint")}
            </Text>
            {/* No backTo: the detail pages already default their return target to /performance. */}
            <PerformanceReviewTable view="own" />
          </Stack>
        </Tabs.Panel>
        {isManager && (
          <Tabs.Panel value="managed" pt="md">
            {/* Self-contained (period picker, filters, its own New-review actions) — it owns
                its hint line and settings, so no wrapper Stack here. */}
            <ReviewsDashboard />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
