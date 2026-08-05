import { Anchor, Paper, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import DaysOffCorrections from "../components/DaysOffCorrections";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import DaysOffTable from "./DaysOffTable";

/**
 * The per-user days-off drill-down — v1 deliberately serves only the HR Audit entry point on
 * the user-details page (`?mode=audit` → the read-only `view=user` auditor table); managers
 * already have the Team tab on /days-off, so a non-auditor visit just redirects there.
 */
export default function UserDaysOff() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, origin, auditMode } = useDashboardDrillDown("days-off");

  if (!idIsValid || !auditMode) return <Navigate to={auditMode ? origin.to : "/days-off"} replace />;

  const who = name ?? t("daysOff.userFallback", { id: userId });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("daysOff.auditTitle", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("daysOff.auditHint", { who })}
        </Text>
      </Stack>

      <DaysOffTable view="user" userId={userId} settingsKey="userDaysOff.audit" />

      {/* The HR auditor's read-only view of the person's budget corrections (v1.43.0). */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t("daysOff.corrections.title")}
          </Text>
          <DaysOffCorrections
            userId={userId}
            defaultYear={new Date().getFullYear()}
            canManage={false}
          />
        </Stack>
      </Paper>
    </Stack>
  );
}
