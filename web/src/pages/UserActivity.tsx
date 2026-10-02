import { Navigate } from "react-router-dom";
import { Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { canAudit, getUserId } from "../api/session";
import ActivityFeed from "../components/ActivityFeed";
import PageHeader from "../components/PageHeader";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";

/**
 * Another person's activity log (`/users/:userId/activity`, v4.9.0): a manager reads a report's
 * (the person-card Profile "Activity" button — the chain's right, entries the manager cannot
 * read themselves are filtered out server-side) and the HR auditor reads anyone's (`?mode=audit`
 * from the User details Audit block — every entry, audited). Not feature-gated (the server drops
 * the viewer's disabled areas); the page asserts no relationship itself — a peer opening the URL
 * gets the server's `403`, rendered as the ordinary permission message. One's own id belongs to
 * the nav page. **The flavor follows the viewer's role, not the URL alone**: HR always receives the
 * audited full view server-side (HR is checked before the chain), so an HR viewer always gets the
 * auditor title/hint and the `userActivity.audit` settings, whatever `?mode` says.
 */
export default function UserActivity() {
  const { t } = useTranslation();
  const { userId, idIsValid, displayName, origin } = useDashboardDrillDown("activity");
  const auditMode = canAudit();

  if (!idIsValid) return <Navigate to={origin.to} replace />;
  if (userId === getUserId()) return <Navigate to="/activity" replace />;

  const who = displayName ?? t("activity.userFallback", { id: userId });

  return (
    <Stack gap="md">
      <PageHeader
        back={{ to: origin.to, label: t("feedback.backToLabel", { label: t(origin.labelKey) }) }}
        title={auditMode ? t("activity.titleAudit", { who }) : t("activity.titleFor", { who })}
        description={auditMode ? t("activity.hintAudit", { who }) : t("activity.hintFor", { who })}
      />
      <ActivityFeed userId={userId} storeKey={auditMode ? "userActivity.audit" : "userActivity.managed"} />
    </Stack>
  );
}
