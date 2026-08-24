import { Anchor, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import ImpactLogTable from "./ImpactLogTable";

/**
 * The per-person impact log drill-down — the HR auditor's read-only journal view (reached
 * from the User details Audit block, `?mode=audit`). Unlike the goals/1:1 drill-downs it has
 * no manager/subordinate flavors: managers read their reports' journals from the Impact log
 * page's managed tab, so a non-audit visit just lands there.
 */
export default function UserImpactLog() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, origin, auditMode, backTo } = useDashboardDrillDown("impact-log");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={origin.to} replace />;
  if (!auditMode) return <Navigate to="/impact-log" replace />;

  const who = name ?? t("impactLog.userFallback", { id: userId });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("impactLog.journalAudit", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("impactLog.journalAuditHint", { who })}
        </Text>
      </Stack>

      {/* The HR auditor view: the person's whole journal, read-only. */}
      <ImpactLogTable view="user" userId={userId} backTo={backTo} settingsKey="userImpactLog.audit" />
    </Stack>
  );
}
