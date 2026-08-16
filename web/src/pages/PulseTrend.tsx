import { lazy, Suspense, useState } from "react";
import { Alert, Chip, Group, Paper, SegmentedControl, Skeleton, Stack, Text } from "@mantine/core";
import { IconChartLine } from "@tabler/icons-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type TeamRef } from "../api/teams";
import { getPulseTrend, getPulseVisibleTeams, type PulseAggregationMode, type PulseTrendResponse } from "../api/pulse";
import EmptyState from "../components/EmptyState";
import { HintIcon } from "../components/PulseTeamResultCard";
import { useStoredState, isOneOf } from "../hooks/useStoredState";
import {
  buildTrendComparisonRows,
  TREND_METRICS,
  trendMetricDomain,
  trendSeriesKey,
  type TrendMetric,
} from "../utils/pulseResults";

const PulseTrendChart = lazy(() => import("../components/PulseTrendChart"));

const VIEWS = ["member", "managed"] as const;
type TrendView = (typeof VIEWS)[number];
const CALCS = ["direct", "indirect"] as const;
type TrendCalc = (typeof CALCS)[number];

// One hue per team pill, assigned by index over the FULL team list so a team keeps its
// color while others toggle off. If there are more teams than hues the colors repeat.
const SERIES_COLORS = ["lettuce.6", "indigo.6", "teal.6", "orange.6", "grape.6", "cyan.6", "pink.6"];

/**
 * The "Trend" tab (team-pills model, v2.14.0): every pill is a TEAM of the active view —
 * toggled-on pills become lines on ONE chart, so several teams compare directly. The member
 * view charts each team's direct members; the managed view adds the same calculation switch
 * as Results ("Direct members only" ↔ "Including everyone below"). One `/trend` request per
 * toggled-on team (cache-shared with the Results cards' mini-charts — identical query keys);
 * the metric picker (eNPS or a driver's favorable%) applies to every line. The fill gate is
 * point-wise on the wire, so a total non-respondent sees gaps → the pending note.
 */
export default function PulseTrend() {
  const { t } = useTranslation();
  const teams = useQuery({ queryKey: ["pulseVisibleTeams"], queryFn: getPulseVisibleTeams });
  const [view, setView] = useStoredState<TrendView>("pulse.trend.view", "member", isOneOf(VIEWS));
  const [calc, setCalc] = useStoredState<TrendCalc>("pulse.trend.calc", "direct", isOneOf(CALCS));
  const [metric, setMetric] = useStoredState<TrendMetric>(
    "pulse.trend.metric",
    "enps",
    isOneOf(TREND_METRICS),
  );

  const viewTeams = (view === "member" ? teams.data?.memberTeams : teams.data?.monitoredTeams) ?? [];
  const wireMode: PulseAggregationMode = view === "managed" && calc === "indirect" ? "subtree" : "direct";

  if (teams.isLoading) return <Skeleton height={280} radius="md" />;
  if (teams.isError) {
    return (
      <Alert color="red" variant="light">
        {t("pulse.error.loadFailed")}
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            aria-label={t("pulse.view.aria")}
            value={view}
            onChange={(value) => setView(value as TrendView)}
            data={VIEWS.map((v) => ({ value: v, label: t(`pulse.view.${v}`) }))}
          />
          {view === "managed" && (
            <SegmentedControl
              aria-label={t("pulse.calc.aria")}
              value={calc}
              onChange={(value) => setCalc(value as TrendCalc)}
              data={CALCS.map((c) => ({ value: c, label: t(`pulse.calc.${c}`) }))}
            />
          )}
        </Group>
        <Group gap="xs" align="center">
          <SegmentedControl
            aria-label={t("pulse.trend.metricAria")}
            value={metric}
            onChange={(value) => setMetric(value as TrendMetric)}
            data={TREND_METRICS.map((m) => ({ value: m, label: t(`pulse.trend.metricLabel.${m}`) }))}
          />
          <HintIcon
            label={metric === "enps" ? t("pulse.results.hint.enps") : t("pulse.results.hint.favorable")}
          />
        </Group>
      </Group>
      {metric !== "enps" && (
        <Text size="sm" c="dimmed">
          {t(`pulse.${metric}`)}
        </Text>
      )}

      {/* The per-view empty states render BELOW the selector (the v2.12.0 rule). */}
      {viewTeams.length === 0 ? (
        <EmptyState
          icon={<IconChartLine size={32} />}
          label={t(view === "member" ? "pulse.view.noMemberTeams" : "pulse.view.noManagedTeams")}
        />
      ) : (
        <TrendChartSection key={view} teams={viewTeams} wireMode={wireMode} metric={metric} />
      )}
    </Stack>
  );
}

/** Keyed by view in the parent so the pill state resets when the view (and team set) changes. */
function TrendChartSection({
  teams,
  wireMode,
  metric,
}: {
  teams: TeamRef[];
  wireMode: PulseAggregationMode;
  metric: TrendMetric;
}) {
  const { t } = useTranslation();
  // All pills start ON (user decision) — each toggled-on pill is one /trend request.
  const [visible, setVisible] = useState<string[]>(teams.map((team) => String(team.id)));
  const toggledTeams = teams.filter((team) => visible.includes(String(team.id)));

  const results = useQueries({
    queries: toggledTeams.map((team) => ({
      queryKey: ["pulseTrend", team.id, wireMode],
      queryFn: () => getPulseTrend(team.id, wireMode),
      retry: false,
    })),
  });
  const loading = results.some((r) => r.isLoading);
  const failed = results.some((r) => r.isError);
  const series = results
    .map((r) => r.data)
    .filter((s): s is PulseTrendResponse => s != null);

  // Every /trend response covers the same global closed-cycle list, so the rows zip cleanly;
  // if requests straddle an admin cycle-close, the builder's cycleId guard yields gaps for
  // the mismatched tail — never misattributed values — until the next refetch.
  const rows = buildTrendComparisonRows(series, metric);
  const defs = series.map((s) => ({
    name: trendSeriesKey(s),
    label: s.teamName,
    color: SERIES_COLORS[teams.findIndex((team) => team.id === s.teamId) % SERIES_COLORS.length],
  }));
  const renderableRows = rows.filter((row) => defs.some((def) => row[def.name] != null));

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Chip.Group multiple value={visible} onChange={setVisible}>
          <Group gap="xs" wrap="wrap" aria-label={t("pulse.trend.seriesAria")} role="group">
            {teams.map((team, index) => (
              <Chip
                key={team.id}
                value={String(team.id)}
                color={SERIES_COLORS[index % SERIES_COLORS.length]}
                size="xs"
              >
                {team.name}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {toggledTeams.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("pulse.trend.noneSelected")}
          </Text>
        ) : loading ? (
          <Skeleton height={260} radius="sm" />
        ) : failed ? (
          <Alert color="red" variant="light">
            {t("pulse.error.loadFailed")}
          </Alert>
        ) : renderableRows.length >= 2 ? (
          <Suspense fallback={<Skeleton height={260} radius="sm" />}>
            <PulseTrendChart data={rows} series={defs} yDomain={trendMetricDomain(metric)} />
          </Suspense>
        ) : (
          <Text size="sm" c="dimmed">
            {t("pulse.results.trendPending")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
