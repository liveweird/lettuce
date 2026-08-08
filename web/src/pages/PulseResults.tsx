import { Alert, Group, SegmentedControl, Select, Skeleton, Stack } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  getPulseResults,
  getPulseVisibleTeams,
  isHr,
  listPulseCycles,
  type PulseAggregationMode,
} from "../api/client";
import EmptyState from "../components/EmptyState";
import PulseTeamResultCard from "../components/PulseTeamResultCard";
import { useStoredState, isOneOf } from "../hooks/useStoredState";
import { closedCycleOptions } from "../utils/pulseResults";

const MODES = ["direct", "subtree"] as const;

/**
 * The "Results" tab: one card per visible team for the picked CLOSED cycle. The cycle pick
 * follows `?cycle=` (the results-notification deep link) and defaults to the latest closed
 * cycle; the direct/subtree scope persists per device. The per-cycle fill gate surfaces as a
 * single informational empty state (probed once on the first team — the server 403s every
 * team uniformly for a non-respondent), never as a wall of red cards.
 */
export default function PulseResults() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useStoredState<PulseAggregationMode>(
    "pulse.results.mode",
    "direct",
    isOneOf(MODES),
  );

  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles });
  const teams = useQuery({ queryKey: ["pulseVisibleTeams"], queryFn: getPulseVisibleTeams });

  const options = closedCycleOptions(cycles.data ?? [], locale, t);
  const requested = searchParams.get("cycle");
  const selectedCycle =
    requested != null && options.some((o) => o.value === requested)
      ? Number(requested)
      : options.length > 0
        ? Number(options[0].value)
        : null;

  const resultsTeams = teams.data?.resultsTeams ?? [];
  const monitoredIds = new Set((teams.data?.monitoredTeams ?? []).map((team) => team.id));
  const firstTeam = resultsTeams[0];

  // The fill-gate probe: shares its query key with the first card, so no extra request.
  const probe = useQuery({
    queryKey: ["pulseResults", selectedCycle, firstTeam?.id, mode],
    queryFn: () => getPulseResults(selectedCycle!, firstTeam!.id, mode),
    enabled: selectedCycle != null && firstTeam != null,
    retry: false,
  });
  const gated = probe.error instanceof ApiError && probe.error.status === 403;

  if (cycles.isLoading || teams.isLoading) return <Skeleton height={280} radius="md" />;
  if (cycles.isError || teams.isError) {
    return (
      <Alert color="red" variant="light">
        {t("pulse.error.loadFailed")}
      </Alert>
    );
  }
  if (options.length === 0) {
    return <EmptyState icon={<IconChartBar size={32} />} label={t("pulse.results.noResultsYet")} />;
  }
  if (resultsTeams.length === 0) {
    return <EmptyState icon={<IconChartBar size={32} />} label={t("pulse.results.noTeams")} />;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          label={t("pulse.results.cycle")}
          data={options}
          value={selectedCycle != null ? String(selectedCycle) : null}
          onChange={(value) => {
            if (value == null) return;
            setSearchParams((params) => {
              params.set("cycle", value);
              return params;
            });
          }}
          allowDeselect={false}
          w={260}
        />
        <SegmentedControl
          aria-label={t("pulse.results.modeAria")}
          value={mode}
          onChange={(value) => setMode(value as PulseAggregationMode)}
          data={MODES.map((m) => ({ value: m, label: t(`pulse.results.mode.${m}`) }))}
        />
      </Group>

      {gated ? (
        <>
          <EmptyState icon={<IconChartBar size={32} />} label={t("pulse.results.resultsGated")} />
          {/* A fill-gated MONITOR (a manager who didn't respond) keeps their comments right —
              render comments-only cards for the monitored teams so the gate never hides them. */}
          {selectedCycle != null &&
            resultsTeams
              .filter((team) => isHr() || monitoredIds.has(team.id))
              .map((team) => (
                <PulseTeamResultCard
                  key={team.id}
                  cycleId={selectedCycle}
                  teamId={team.id}
                  teamName={team.name}
                  mode={mode}
                  canMonitor
                  commentsOnly
                />
              ))}
        </>
      ) : (
        selectedCycle != null &&
        resultsTeams.map((team) => (
          <PulseTeamResultCard
            key={team.id}
            cycleId={selectedCycle}
            teamId={team.id}
            teamName={team.name}
            mode={mode}
            canMonitor={isHr() || monitoredIds.has(team.id)}
          />
        ))
      )}
    </Stack>
  );
}
