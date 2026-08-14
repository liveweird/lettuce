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

// The v2.12.0 two-view layout: which teams are LISTED follows the view, not just how each
// card aggregates. "member" = teams the caller belongs to (always direct numbers); "managed"
// = the monitored tree, with its own direct/indirect calculation toggle.
const VIEWS = ["member", "managed"] as const;
type ResultsView = (typeof VIEWS)[number];
const CALCS = ["direct", "indirect"] as const;
type ResultsCalc = (typeof CALCS)[number];

/**
 * The "Results" tab: one card per team of the picked view for the picked CLOSED cycle. The
 * cycle pick follows `?cycle=` (the results-notification deep link) and defaults to the
 * latest closed cycle; the view and the managed view's calculation toggle persist per
 * device. The per-cycle fill gate surfaces as a single informational empty state (probed
 * once on the active view's first team — the server 403s every team uniformly for a
 * non-respondent), never as a wall of red cards.
 */
export default function PulseResults() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useStoredState<ResultsView>("pulse.results.view", "member", isOneOf(VIEWS));
  const [calc, setCalc] = useStoredState<ResultsCalc>("pulse.results.calc", "direct", isOneOf(CALCS));

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

  const monitoredIds = new Set((teams.data?.monitoredTeams ?? []).map((team) => team.id));
  // The member view is always direct numbers; the managed view follows its calc toggle.
  const viewTeams = (view === "member" ? teams.data?.memberTeams : teams.data?.monitoredTeams) ?? [];
  const wireMode: PulseAggregationMode = view === "managed" && calc === "indirect" ? "subtree" : "direct";
  const firstTeam = viewTeams[0];

  // The fill-gate probe: shares its query key with the active view's first card, so no
  // extra request.
  const probe = useQuery({
    queryKey: ["pulseResults", selectedCycle, firstTeam?.id, wireMode],
    queryFn: () => getPulseResults(selectedCycle!, firstTeam!.id, wireMode),
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
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            aria-label={t("pulse.view.aria")}
            value={view}
            onChange={(value) => setView(value as ResultsView)}
            data={VIEWS.map((v) => ({ value: v, label: t(`pulse.view.${v}`) }))}
          />
          {view === "managed" && (
            <SegmentedControl
              aria-label={t("pulse.calc.aria")}
              value={calc}
              onChange={(value) => setCalc(value as ResultsCalc)}
              data={CALCS.map((c) => ({ value: c, label: t(`pulse.calc.${c}`) }))}
            />
          )}
        </Group>
      </Group>

      {/* The per-view empty states render BELOW the selector — a member-of-nothing manager
          must still be able to switch to "Teams I manage" (and vice versa). */}
      {viewTeams.length === 0 ? (
        <EmptyState
          icon={<IconChartBar size={32} />}
          label={t(view === "member" ? "pulse.view.noMemberTeams" : "pulse.view.noManagedTeams")}
        />
      ) : gated ? (
        <>
          <EmptyState icon={<IconChartBar size={32} />} label={t("pulse.results.resultsGated")} />
          {/* A fill-gated MONITOR (a manager who didn't respond) keeps their comments right —
              render comments-only cards for the monitored teams so the gate never hides them
              (view-independent: monitoring is a standing right, not a view choice). */}
          {selectedCycle != null &&
            (teams.data?.monitoredTeams ?? []).map((team) => (
                <PulseTeamResultCard
                  key={team.id}
                  cycleId={selectedCycle}
                  teamId={team.id}
                  teamName={team.name}
                  mode="direct"
                  canMonitor
                  commentsOnly
                />
            ))}
        </>
      ) : (
        selectedCycle != null &&
        viewTeams.map((team) => (
          <PulseTeamResultCard
            key={team.id}
            cycleId={selectedCycle}
            teamId={team.id}
            teamName={team.name}
            mode={wireMode}
            canMonitor={isHr() || monitoredIds.has(team.id)}
          />
        ))
      )}
    </Stack>
  );
}
