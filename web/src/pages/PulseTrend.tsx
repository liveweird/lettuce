import { lazy, Suspense, useState } from "react";
import { Alert, Chip, Group, Paper, SegmentedControl, Select, Skeleton, Stack, Text } from "@mantine/core";
import { IconChartLine } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getPulseTrendComparison,
  getPulseVisibleTeams,
  type PulseTrendComparison,
} from "../api/client";
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

// Own-direct keeps the brand color (the primary line); the rest cycle distinct hues. If a
// team has more children than hues the colors repeat — the chips disambiguate.
const SERIES_COLORS = ["indigo.6", "teal.6", "orange.6", "grape.6", "cyan.6", "pink.6"];

/**
 * The "Trend" tab (v2.11.0): how results evolve across closed cycles for one picked team's
 * three scope families — direct members, whole subtree, each direct sub-team's subtree —
 * on one multi-line chart with per-series toggle chips and a metric picker (eNPS or a fixed
 * driver's favorable%). The fill gate is point-wise on the wire (never a request-level 403
 * for a visible team), so a total non-respondent simply sees gaps → the pending note.
 */
export default function PulseTrend() {
  const { t } = useTranslation();
  const teams = useQuery({ queryKey: ["pulseVisibleTeams"], queryFn: getPulseVisibleTeams });
  const [metric, setMetric] = useStoredState<TrendMetric>(
    "pulse.trend.metric",
    "enps",
    isOneOf(TREND_METRICS),
  );
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);

  const resultsTeams = teams.data?.resultsTeams ?? [];
  const teamId =
    pickedTeam != null && resultsTeams.some((team) => String(team.id) === pickedTeam)
      ? Number(pickedTeam)
      : (resultsTeams[0]?.id ?? null);

  const trend = useQuery({
    queryKey: ["pulseTrendComparison", teamId],
    queryFn: () => getPulseTrendComparison(teamId!),
    enabled: teamId != null,
    retry: false,
  });

  if (teams.isLoading) return <Skeleton height={280} radius="md" />;
  if (teams.isError) {
    return (
      <Alert color="red" variant="light">
        {t("pulse.error.loadFailed")}
      </Alert>
    );
  }
  if (resultsTeams.length === 0) {
    return <EmptyState icon={<IconChartLine size={32} />} label={t("pulse.results.noTeams")} />;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          label={t("pulse.trend.team")}
          data={resultsTeams.map((team) => ({ value: String(team.id), label: team.name }))}
          value={teamId != null ? String(teamId) : null}
          onChange={(value) => value != null && setPickedTeam(value)}
          allowDeselect={false}
          w={260}
        />
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

      {trend.isLoading && <Skeleton height={280} radius="md" />}
      {trend.isError && (
        <Alert color="red" variant="light">
          {t("pulse.error.loadFailed")}
        </Alert>
      )}
      {trend.data && <TrendChartSection key={teamId} bundle={trend.data} metric={metric} />}
    </Stack>
  );
}

/** Keyed by teamId in the parent so the chip state resets whenever the team pick changes. */
function TrendChartSection({ bundle, metric }: { bundle: PulseTrendComparison; metric: TrendMetric }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<string[]>(bundle.series.map(trendSeriesKey));

  const seriesLabel = (index: number): string => {
    const series = bundle.series[index];
    if (series.teamId === bundle.teamId) {
      return series.mode === "direct" ? t("pulse.trend.series.own") : t("pulse.trend.series.subtree");
    }
    return series.teamName;
  };
  const seriesColor = (index: number): string =>
    index === 0 ? "lettuce.6" : SERIES_COLORS[(index - 1) % SERIES_COLORS.length];

  const defs = bundle.series.map((series, index) => ({
    key: trendSeriesKey(series),
    name: trendSeriesKey(series),
    label: seriesLabel(index),
    color: seriesColor(index),
  }));
  const visibleDefs = defs.filter((def) => visible.includes(def.key));
  const visibleSeries = bundle.series.filter((series) => visible.includes(trendSeriesKey(series)));
  const rows = buildTrendComparisonRows(visibleSeries, metric);
  // A row "renders" when at least one toggled-on series has a value at that cycle.
  const renderableRows = rows.filter((row) => visibleDefs.some((def) => row[def.name] != null));

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Chip.Group multiple value={visible} onChange={setVisible}>
          <Group gap="xs" wrap="wrap" aria-label={t("pulse.trend.seriesAria")} role="group">
            {defs.map((def) => (
              <Chip key={def.key} value={def.key} color={def.color} size="xs">
                {def.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {bundle.series.length === 2 && (
          <Text size="sm" c="dimmed">
            {t("pulse.trend.noChildren")}
          </Text>
        )}
        {renderableRows.length >= 2 ? (
          <Suspense fallback={<Skeleton height={260} radius="sm" />}>
            <PulseTrendChart data={rows} series={visibleDefs} yDomain={trendMetricDomain(metric)} />
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
