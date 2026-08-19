import { Container, Stack, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { hasFeature, isAdmin } from "../api/session";
import { getPulseSettings, listPulseCycles } from "../api/pulse";
import PulseCycleTable from "../components/PulseCycleTable";
import PulseScheduleCard from "../components/PulseScheduleCard";
import PulseSettingsCard from "../components/PulseSettingsCard";

/**
 * The ADMIN cycle-management screen (Config nav; the ReviewPeriods blueprint), composed of
 * three self-contained sections: the advisory settings (PulseSettingsCard), the scheduling
 * form with its derived date prefills (PulseScheduleCard — opening and closing stay manual),
 * and the cycle registry with the per-status lifecycle actions (PulseCycleTable). The two
 * queries live here because each feeds two sections.
 */
export default function PulseCycles() {
  const { t } = useTranslation();

  const settings = useQuery({ queryKey: ["pulseSettings"], queryFn: getPulseSettings, enabled: isAdmin() });
  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles, enabled: isAdmin() });

  if (!hasFeature("PULSE_SURVEYS") || !isAdmin()) return <Navigate to="/" replace />;

  return (
    <Container size="sm" px={0}>
      <Stack gap="lg">
        <Title order={2} data-tour="config-pulse-cycles">
          {t("pulse.admin.title")}
        </Title>
        <PulseSettingsCard settings={settings.data} settingsError={settings.isError} />
        <PulseScheduleCard settings={settings.data} cycles={cycles.data} />
        <PulseCycleTable cycles={cycles.data} isLoading={cycles.isLoading} isError={cycles.isError} />
      </Stack>
    </Container>
  );
}
