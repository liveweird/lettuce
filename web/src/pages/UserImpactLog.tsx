import { Stack } from "@mantine/core";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import PageHeader from "../components/PageHeader";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import ImpactLogTable from "./ImpactLogTable";

/**
 * The per-person impact log drill-down: the HR auditor's read-only journal view (reached
 * from the User details Audit block, `?mode=audit`) and, since v2.38.0, the manager's — the
 * person-card Performance section's Impact-log button pins the managed list to one report
 * (the UserPerformanceReviews shape). There is no subordinate flavor (a report never reads
 * their manager's journal), so any other visit lands on the Impact log page.
 */
export default function UserImpactLog() {
  const { t } = useTranslation();
  const { userId, idIsValid, displayName, origin, callerManages, auditMode, backTo } =
    useDashboardDrillDown("impact-log");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={origin.to} replace />;
  if (!auditMode && !callerManages) return <Navigate to="/impact-log" replace />;

  const who = displayName ?? t("impactLog.userFallback", { id: userId });

  return (
    <Stack gap="md">
      <PageHeader
        back={{ to: origin.to, label: t("feedback.backToLabel", { label: t(origin.labelKey) }) }}
        title={auditMode ? t("impactLog.journalAudit", { who }) : t("impactLog.journalFor", { who })}
        description={
          auditMode ? t("impactLog.journalAuditHint", { who }) : t("impactLog.journalForHint", { who })
        }
      />

      {auditMode ? (
        // The HR auditor view: the person's whole journal, read-only.
        <ImpactLogTable view="user" userId={userId} backTo={backTo} settingsKey="userImpactLog.audit" />
      ) : (
        // The manager side: the managed list pinned to this report (includeIndirect — the
        // chain read is a right, so an indirect report's journal lists too).
        <ImpactLogTable
          view="managed"
          userId={userId}
          includeIndirect
          backTo={backTo}
          settingsKey="userImpactLog.managed"
        />
      )}
    </Stack>
  );
}
