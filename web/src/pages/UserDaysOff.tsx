import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAdjustments, IconPencil } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { listDaysOffBudgets, setDaysOffAllowance } from "../api/daysoff";
import DaysOffCorrections from "../components/DaysOffCorrections";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import { MAX_PAID_DAYS_OFF_ALLOWANCE, formatDays } from "../utils/daysOffCost";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import DaysOffTable from "./DaysOffTable";

// The chain manager's allowance editor (v2.32.0 — the allowance moved off the admin user
// form): a small modal over the budget strip's Allowance figure. The server guards the
// chain right; an idempotent re-save is a silent 204.
function AllowanceModal({
  userId,
  name,
  current,
  opened,
  onClose,
}: {
  userId: number;
  name: string;
  current: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<number | string>(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (typeof value !== "number") {
      setError(t("daysOff.budget.allowanceRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setDaysOffAllowance(userId, value);
      await queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
      showSuccessToast(t("daysOff.toast.allowanceSaved"));
      onClose();
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "daysOff.budget.allowancePermission",
          failed: "daysOff.budget.allowanceFailed",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (saving) return;
        setError(null);
        setValue(current ?? "");
        onClose();
      }}
      title={t("daysOff.budget.allowanceModalTitle", { name })}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("daysOff.budget.allowanceHint")}
        </Text>
        <NumberInput
          label={t("daysOff.budget.allowanceLabel")}
          min={0}
          max={MAX_PAID_DAYS_OFF_ALLOWANCE}
          allowDecimal={false}
          clampBehavior="strict"
          value={value}
          onChange={setValue}
          withAsterisk
          data-autofocus
        />
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            {t("common.action.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t("common.action.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// The manager-mode budget strip for ONE report: the managed budgets fetch (includeIndirect —
// the row exists exactly when the person is in the caller's transitive subtree, v2.32.0),
// the chain-editable Allowance figure, and the Corrections modal — manage-capable only for a
// DIRECT manager (the row's server-computed canCorrect; chain managers get the read-only view).
function UserBudgetSection({ userId, name }: { userId: number; name: string }) {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "managed", "indirect", year],
    queryFn: () => listDaysOffBudgets("managed", year, { includeIndirect: true }),
  });
  const budget = data?.find((b) => b.userId === userId);
  const days = (v: number) => formatDays(v, i18n.language);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        {/* One compact toolbar line (v2.32.1): the year Select drops its stacked label
            (aria-label keeps it accessible) and sizes to the xs button, so title, picker,
            and button share a centerline; the pair wraps together on narrow widths. */}
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {t("daysOff.budget.userTitle", { name, year })}
          </Text>
          <Group gap="xs" align="center" wrap="nowrap">
            <Select
              size="xs"
              aria-label={t("daysOff.budget.year")}
              data={[currentYear - 1, currentYear, currentYear + 1].map((y) => String(y))}
              value={String(year)}
              onChange={(v) => v && setYear(Number(v))}
              allowDeselect={false}
              w={90}
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
                <Group gap={4} wrap="nowrap">
                  <Text size="lg" fw={key === "remaining" ? 700 : 500}>
                    {value}
                  </Text>
                  {key === "allowance" && (
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => setAllowanceOpen(true)}
                      aria-label={t("daysOff.budget.editAllowanceAria", { name })}
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                  )}
                </Group>
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
        <DaysOffCorrections userId={userId} defaultYear={year} canManage={budget?.canCorrect ?? false} />
      </Modal>
      {budget && (
        <AllowanceModal
          userId={userId}
          name={name}
          current={budget.allowance}
          opened={allowanceOpen}
          onClose={() => setAllowanceOpen(false)}
        />
      )}
    </Paper>
  );
}

/**
 * The per-user days-off drill-down: the HR-audit flavor (`?mode=audit` — the read-only
 * `view=user` table + corrections) and, since v1.44.0, the manager flavor (origins
 * `subordinates`/`team`, or `from=details&manages=1`) — that report's requests (v2.32.0:
 * includeIndirect, so the page works for the whole chain; the rows' canResolve/canCancel keep
 * the actions honest), their budget for a picked year with the chain-editable allowance, and
 * the Corrections modal (manage-capable for direct managers only). Anyone else redirects to
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
          <DaysOffTable view="managed" userId={userId} settingsKey="userDaysOff.managed" includeIndirect />
        </>
      )}
    </Stack>
  );
}
