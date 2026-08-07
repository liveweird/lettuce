import { useState } from "react";
import { Alert, Anchor, Button, Group, Modal, Paper, Select, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature, listDaysOffBudgets } from "../api/client";
import DaysOffCorrections from "../components/DaysOffCorrections";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import { formatDays } from "../utils/daysOffCost";
import DaysOffTable from "./DaysOffTable";

// The manager-mode budget strip for ONE report: the managed budgets fetch, filtered to the
// person (the endpoint is direct-reports-scoped, so the row exists exactly when the caller
// really manages them), plus the manage-capable Corrections modal.
function UserBudgetSection({ userId, name }: { userId: number; name: string }) {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "managed", year],
    queryFn: () => listDaysOffBudgets("managed", year),
  });
  const budget = data?.find((b) => b.userId === userId);
  const days = (v: number) => formatDays(v, i18n.language);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-end">
          <Text size="sm" fw={600}>
            {t("daysOff.budget.userTitle", { name, year })}
          </Text>
          <Group gap="sm" align="flex-end">
            <Select
              label={t("daysOff.budget.year")}
              data={[currentYear - 1, currentYear, currentYear + 1].map((y) => String(y))}
              value={String(year)}
              onChange={(v) => v && setYear(Number(v))}
              allowDeselect={false}
              w={110}
            />
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconAdjustments size={14} />}
              onClick={() => setCorrectionsOpen(true)}
              aria-label={t("daysOff.corrections.openAria", { name })}
            >
              {t("daysOff.corrections.title")}
            </Button>
          </Group>
        </Group>
        {isError ? (
          <Alert color="red" variant="light">
            {t("daysOff.budget.loadError")}
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton height={40} />
        ) : budget ? (
          <Group gap="xl" wrap="wrap">
            {(
              [
                ["allowance", budget.allowance != null ? days(budget.allowance) : "—"],
                ["carriedOver", days(budget.carriedOver)],
                ["corrected", budget.corrected === 0 ? "—" : `${budget.corrected > 0 ? "+" : ""}${days(budget.corrected)}`],
                ["reserved", days(budget.reserved)],
                ["used", days(budget.used)],
                ["remaining", days(budget.remaining)],
              ] as const
            ).map(([key, value]) => (
              <Stack key={key} gap={0} miw={90}>
                <Text size="xs" c="dimmed">
                  {t(`daysOff.budget.${key}`)}
                </Text>
                <Text size="lg" fw={key === "remaining" ? 700 : 500}>
                  {value}
                </Text>
              </Stack>
            ))}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            {t("daysOff.budget.notAReport")}
          </Text>
        )}
      </Stack>

      <Modal
        opened={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        title={t("daysOff.corrections.modalTitle", { name })}
        size="lg"
      >
        <DaysOffCorrections userId={userId} defaultYear={year} canManage />
      </Modal>
    </Paper>
  );
}

/**
 * The per-user days-off drill-down: the HR-audit flavor (`?mode=audit` — the read-only
 * `view=user` table + corrections) and, since v1.44.0, the manager flavor (origins
 * `subordinates`/`team`, or `from=details&manages=1`) — that report's requests with the
 * Accept/Reject row actions (the userId pin keeps every row a direct report's), their budget
 * for a picked year, and the manage-capable Corrections modal. Anyone else redirects to
 * /days-off (managers already have the aggregate Team tab there).
 */
export default function UserDaysOff() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, origin, callerManages, auditMode } =
    useDashboardDrillDown("days-off");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;
  if (!idIsValid || (!auditMode && !callerManages)) return <Navigate to="/days-off" replace />;

  const who = name ?? t("daysOff.userFallback", { id: userId });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t(auditMode ? "daysOff.auditTitle" : "daysOff.managedTitle", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(auditMode ? "daysOff.auditHint" : "daysOff.managedHint", { who })}
        </Text>
      </Stack>

      {auditMode ? (
        <>
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
        </>
      ) : (
        <>
          <UserBudgetSection userId={userId} name={who} />
          <DaysOffTable view="managed" userId={userId} settingsKey="userDaysOff.managed" />
        </>
      )}
    </Stack>
  );
}
