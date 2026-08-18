import { Alert, Button, Group, NumberInput, Paper, Stack, Text, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updatePulseSettings, type PulseSettings } from "../api/pulse";
import { invalidatePulse } from "../utils/pulseQueries";
import { saveErrorMessage, type SaveErrorKeys } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const ERROR_KEYS: SaveErrorKeys = {
  conflict: "pulse.error.conflict",
  invalid: "pulse.error.invalid",
  failedStatus: "pulse.error.failedStatus",
  failed: "pulse.error.failed",
};

/** The advisory cadence/open-window settings editor of the admin PulseCycles page. */
export default function PulseSettingsCard({ settings }: { settings: PulseSettings | undefined }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const form = useForm<PulseSettings>({ initialValues: { cadenceWeeks: 4, openDays: 7 } });
  if (settings && !form.initialized) form.initialize(settings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(values: PulseSettings) {
    setSaving(true);
    setError(null);
    try {
      await updatePulseSettings(values);
      showSuccessToast(t("pulse.toast.settingsSaved"));
      await invalidatePulse(queryClient);
    } catch (err) {
      setError(saveErrorMessage(err, t, ERROR_KEYS));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <form onSubmit={form.onSubmit(save)} noValidate>
        <Stack gap="sm">
          <Title order={4}>{t("pulse.admin.settingsTitle")}</Title>
          <Text size="sm" c="dimmed">
            {t("pulse.admin.settingsHint")}
          </Text>
          <Group grow>
            <NumberInput
              label={t("pulse.admin.cadenceWeeks")}
              min={1}
              max={52}
              allowDecimal={false}
              {...form.getInputProps("cadenceWeeks")}
            />
            <NumberInput
              label={t("pulse.admin.openDays")}
              min={1}
              max={90}
              allowDecimal={false}
              {...form.getInputProps("openDays")}
            />
          </Group>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button type="submit" loading={saving} variant="default">
              {t("pulse.admin.saveSettings")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
