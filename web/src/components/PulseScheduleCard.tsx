import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import DateField from "./DateField";
import { createPulseCycle, type PulseCycle, type PulseSettings } from "../api/pulse";
import { addIsoDays, isValidIsoDate, todayIsoDate } from "../utils/datetime";
import { invalidatePulse } from "../utils/pulseQueries";
import { saveErrorMessage, type SaveErrorKeys } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const ERROR_KEYS: SaveErrorKeys = {
  conflict: "pulse.admin.scheduleConflict",
  invalid: "pulse.error.invalid",
  failedStatus: "pulse.error.failedStatus",
  failed: "pulse.error.failed",
};

/**
 * The cycle-scheduling form of the admin PulseCycles page. The dates are DERIVED defaults
 * (latest non-cancelled cycle + cadence; close = open + openDays) that a manual edit
 * overrides — null input = "not touched", so no set-state-in-effect and the close date keeps
 * following an edited open date until the admin touches it themselves.
 */
export default function PulseScheduleCard({
  settings,
  cycles,
}: {
  settings: PulseSettings | undefined;
  cycles: PulseCycle[] | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [openDateInput, setOpenDateInput] = useState<string | null>(null);
  const [closeDateInput, setCloseDateInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const latestCycle = cycles?.find((c) => c.status !== "CANCELLED");
  const defaultOpenDate =
    settings && cycles
      ? latestCycle
        ? addIsoDays(latestCycle.plannedOpenDate, settings.cadenceWeeks * 7)
        : todayIsoDate()
      : "";
  const openDate = openDateInput ?? defaultOpenDate;
  const closeDate =
    closeDateInput ??
    (settings && isValidIsoDate(openDate) ? addIsoDays(openDate, settings.openDays) : "");

  async function schedule() {
    if (!isValidIsoDate(openDate)) {
      setError(t("pulse.validation.openDateInvalid"));
      return;
    }
    if (!isValidIsoDate(closeDate) || closeDate <= openDate) {
      setError(t("pulse.validation.closeDateInvalid"));
      return;
    }
    setScheduling(true);
    setError(null);
    try {
      await createPulseCycle({ plannedOpenDate: openDate, plannedCloseDate: closeDate });
      showSuccessToast(t("pulse.toast.scheduled"));
      // Back to derived defaults — the next cycle's prefill follows the one just created.
      setOpenDateInput(null);
      setCloseDateInput(null);
      await invalidatePulse(queryClient);
    } catch (err) {
      setError(saveErrorMessage(err, t, ERROR_KEYS));
    } finally {
      setScheduling(false);
    }
  }

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Title order={4}>{t("pulse.admin.scheduleTitle")}</Title>
        <Text size="sm" c="dimmed">
          {t("pulse.admin.scheduleHint")}
        </Text>
        <Group grow>
          <DateField
            label={t("pulse.admin.openDate")}
            value={openDate}
            onChange={(iso) => setOpenDateInput(iso)}
          />
          <DateField
            label={t("pulse.admin.closeDate")}
            value={closeDate}
            onChange={(iso) => setCloseDateInput(iso)}
          />
        </Group>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button onClick={schedule} loading={scheduling}>
            {t("pulse.admin.schedule")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
