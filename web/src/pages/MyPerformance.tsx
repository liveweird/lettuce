import { Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import PerformanceReviewTable from "./PerformanceReviewTable";

// The caller's own performance reviews — the server's own view is PUBLISHED-only, so a review
// in progress (DRAFT/CALIBRATION) is invisible here until the manager publishes it. No tabs
// and no create affordance: authoring is the manager's side (the dashboard tab / drill-downs).
export default function MyPerformance() {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Title order={2}>{t("performanceReview.myTitle")}</Title>
      <Text size="sm" c="dimmed">
        {t("performanceReview.myHint")}
      </Text>
      {/* No backTo: the detail pages already default their return target to /my-performance. */}
      <PerformanceReviewTable view="own" />
    </Stack>
  );
}
