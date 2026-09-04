import { Stack } from "@mantine/core";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import PageHeader from "../components/PageHeader";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import SuccessionPlanTable from "./SuccessionPlanTable";

/**
 * The per-person succession drill-down — the HR auditor's read-only view of every plan the
 * person is a party to (as the seat's person or as the owning manager), reached from the User
 * details Audit block (`?mode=audit`). There is no manager flavor: a chain manager reads
 * their report managers' plans on the Succession page's team tab, so any non-audit visit
 * lands there.
 */
export default function UserSuccessionPlans() {
  const { t } = useTranslation();
  const { userId, idIsValid, displayName, origin, auditMode, backTo } = useDashboardDrillDown("succession");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("SUCCESSION_PLANS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={origin.to} replace />;
  if (!auditMode) return <Navigate to="/succession" replace />;

  const who = displayName ?? t("succession.userFallback", { id: userId });

  return (
    <Stack gap="md">
      <PageHeader
        back={{ to: origin.to, label: t("feedback.backToLabel", { label: t(origin.labelKey) }) }}
        title={t("succession.plansAudit", { who })}
        description={t("succession.plansAuditHint", { who })}
      />

      <SuccessionPlanTable
        view="user"
        userId={userId}
        backTo={backTo}
        settingsKey="userSuccession.audit"
      />
    </Stack>
  );
}
