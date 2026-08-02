import { Link as RouterLink, Navigate } from "react-router-dom";
import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useDashboardDrillDown, type DashboardOriginKey } from "../hooks/useDashboardDrillDown";
import { reviewCreateLink } from "../utils/performanceReviewLinks";
import PerformanceReviewTable from "./PerformanceReviewTable";

// Per-origin wording: manager-side origins list the subordinate's reviews, the managers/details
// origins list "their reviews of you" (the UserGoals idiom); audit mode overrides both.
const WORDING: Record<DashboardOriginKey, { titleKey: string; hintKey: string }> = {
  managers: { titleKey: "performanceReview.reviewsWith", hintKey: "performanceReview.reviewsWithHint" },
  subordinates: { titleKey: "performanceReview.reviewsFor", hintKey: "performanceReview.reviewsForHint" },
  team: { titleKey: "performanceReview.reviewsFor", hintKey: "performanceReview.reviewsForHint" },
  details: { titleKey: "performanceReview.reviewsAudit", hintKey: "performanceReview.reviewsAuditHint" },
};

export default function UserPerformanceReviews() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, originKey, origin, callerManages, auditMode, backTo } =
    useDashboardDrillDown("performance-reviews");
  if (!idIsValid) return <Navigate to={origin.to} replace />;
  const who = name ?? t("performanceReview.userFallback", { id: userId });
  const wording = auditMode
    ? { titleKey: "performanceReview.reviewsAudit", hintKey: "performanceReview.reviewsAuditHint" }
    : WORDING[originKey];

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t(wording.titleKey, { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(wording.hintKey, { who })}
        </Text>
      </Stack>

      {auditMode ? (
        // The HR auditor view: every review this person is a party to, read-only.
        <PerformanceReviewTable view="user" userId={userId} backTo={backTo} settingsKey="userReviews.audit" />
      ) : callerManages ? (
        // The manager side: ALL the subordinate's reviews the caller can list — their own plus
        // chain-authored ones (includeIndirect; chain DRAFTs stay hidden server-side).
        <PerformanceReviewTable
          view="managed"
          subordinateId={userId}
          includeIndirect
          backTo={backTo}
          settingsKey="userReviews.managed"
        />
      ) : (
        // The caller is the subordinate: the clicked manager's published reviews of them.
        <PerformanceReviewTable view="own" managerId={userId} backTo={backTo} settingsKey="userReviews" />
      )}

      {callerManages && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={reviewCreateLink(userId, name, backTo)}
            leftSection={<IconPlus size={16} />}
          >
            {t("performanceReview.newReview")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
