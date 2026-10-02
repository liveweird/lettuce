import { Navigate } from "react-router-dom";
import { Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import ActivityFeed from "../components/ActivityFeed";
import PageHeader from "../components/PageHeader";

/**
 * "My activity" (`/activity`, v4.9.0): the caller's own chronological log — what they did across
 * documents, shares, days-off and career actions, and sign-ins. Not feature-gated: ungated areas
 * always show and the server omits the areas the caller has disabled. A report's or an auditee's
 * log is `UserActivity` at `/users/:userId/activity`.
 */
export default function ActivityLog() {
  const { t } = useTranslation();
  const userId = getUserId();
  if (userId == null) return <Navigate to="/" replace />;
  return (
    <Stack gap="md">
      <PageHeader title={t("activity.title")} description={t("activity.description")} />
      <ActivityFeed userId={userId} storeKey="activity.own" />
    </Stack>
  );
}
