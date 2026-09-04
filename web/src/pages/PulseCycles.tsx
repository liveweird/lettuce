import { Grid, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { hasFeature, isAdmin } from "../api/session";
import { getPulseSettings, listPulseCycles } from "../api/pulse";
import PageHeader from "../components/PageHeader";
import PulseCycleTable from "../components/PulseCycleTable";
import PulseScheduleCard from "../components/PulseScheduleCard";
import PulseSettingsCard from "../components/PulseSettingsCard";

/**
 * The ADMIN cycle-management screen (Config nav; the registry list-page shape since v3.4.0),
 * composed of three self-contained sections: the advisory settings (PulseSettingsCard) and
 * the scheduling form with its derived date prefills (PulseScheduleCard — opening and closing
 * stay manual) side by side, then the full-width cycle registry with the per-status lifecycle
 * actions (PulseCycleTable). The two queries live here because each feeds two sections.
 */
export default function PulseCycles() {
  const { t } = useTranslation();

  const settings = useQuery({ queryKey: ["pulseSettings"], queryFn: getPulseSettings, enabled: isAdmin() });
  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles, enabled: isAdmin() });

  if (!hasFeature("PULSE_SURVEYS") || !isAdmin()) return <Navigate to="/" replace />;

  return (
    <Stack gap="lg">
      <PageHeader title={t("pulse.admin.title")} tourId="config-pulse-cycles" />
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <PulseSettingsCard settings={settings.data} settingsError={settings.isError} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <PulseScheduleCard settings={settings.data} cycles={cycles.data} />
        </Grid.Col>
      </Grid>
      <PulseCycleTable cycles={cycles.data} isLoading={cycles.isLoading} isError={cycles.isError} />
    </Stack>
  );
}
