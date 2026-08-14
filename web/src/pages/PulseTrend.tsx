import { lazy, Suspense, useState } from "react";
import { Alert, Chip, Group, Paper, SegmentedControl, Select, Skeleton, Stack, Text } from "@mantine/core";
import { IconChartLine } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getPulseTrend,
  getPulseTrendComparison,
  getPulseVisibleTeams,
  type PulseTrendComparison,
  type PulseTrendResponse,
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

// The v2.12.0 two-view model, mirrored (v2.13.0): "member" = teams the caller belongs to,
// one own-members line; "managed" = the monitored tree with the full multi-series chart.
const VIEWS = ["member", "managed"] as const;
type TrendView = (typeof VIEWS)[number];

// Own-direct keeps the brand color (the primary line); the rest cycle distinct hues. If a
// team has more children than hues the colors repeat — the chips disambiguate.
const SERIES_COLORS = ["indigo.6", "teal.6", "orange.6", "grape.6", "cyan.6", "pink.6"];

/**
 * The "Trend" tab (v2.11.0, two-view since v2.13.0): how results evolve across closed
 * cycles for one picked team. The member view charts a single line — the team's direct
 * members; the managed view compares the three scope families (direct members, whole
 * subtree, each direct sub-team's subtree) with per-series toggle chips. A metric picker
 * (eNPS or a fixed driver's favorable%) applies to both. The fill gate is point-wise on
 * the wire (never a request-level 403 for a visible team), so a total non-respondent
 * simply sees gaps → the pending note.
 */
export default function PulseTrend() {
  const { t } = useTranslation();
  const teams = useQuery({ queryKey: ["pulseVisibleTeams"], queryFn: getPulseVisibleTeams });
  const [view, setView] = useStoredState<TrendView>("pulse.trend.view", "member", isOneOf(VIEWS));
  const [metric, setMetric] = useStoredState<TrendMetric>(
    "pulse.trend.metric",
    "enps",
    isOneOf(TREND_METRICS),
  );
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);

  const viewTeams = (view === "member" ? teams.data?.memberTeams : teams.data?.monitoredTeams) ?? [];
  const teamId =
    pickedTeam != null && viewTeams.some((team) => String(team.id) === pickedTeam)
      ? Number(pickedTeam)
      : (viewTeams[0]?.id ?? null);

  // Member view: the single-team direct series (the result cards' mini-chart query — same
  // key and fetch, so the cache is shared). Managed view: the comparison bundle.
  const memberTrend = useQuery({
    queryKey: ["pulseTrend", teamId, "direct"],
    queryFn: () => getPulseTrend(teamId!, "direct"),
    enabled: view === "member" && teamId != null,
    retry: false,
  });
  const managedTrend = useQuery({
    queryKey: ["pulseTrendComparison", teamId],
    queryFn: () => getPulseTrendComparison(teamId!),
    enabled: view === "managed" && teamId != null,
    retry: false,
  });
  const trend = view === "member" ? memberTrend : managedTrend;

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
        <Group gap="xs" align="flex-end" wrap="wrap">
          <SegmentedControl
            aria-label={t("pulse.view.aria")}
            value={view}
            onChange={(value) => setView(value as TrendView)}
            data={VIEWS.map((v) => ({ value: v, label: t(`pulse.view.${v}`) }))}
          />
          {viewTeams.length > 0 && (
            <Select
              label={t("pulse.trend.team")}
              data={viewTeams.map((team) => ({ value: String(team.id), label: team.name }))}
              value={teamId != null ? String(teamId) : null}
              onChange={(value) => value != null && setPickedTeam(value)}
              allowDeselect={false}
              w={260}
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

      {/* The per-view empty states render BELOW the selector (the v2.12.0 rule) — a
          member-of-nothing manager must still be able to switch views. */}
      {viewTeams.length === 0 ? (
        <EmptyState
          icon={<IconChartLine size={32} />}
          label={t(view === "member" ? "pulse.view.noMemberTeams" : "pulse.view.noManagedTeams")}
        />
      ) : (
        <>
          {trend.isLoading && <Skeleton height={280} radius="md" />}
          {trend.isError && (
            <Alert color="red" variant="light">
              {t("pulse.error.loadFailed")}
            </Alert>
          )}
          {view === "member" && memberTrend.data && (
            <MemberTrendCard series={memberTrend.data} metric={metric} />
          )}
          {view === "managed" && managedTrend.data && (
            <TrendChartSection key={teamId} bundle={managedTrend.data} metric={metric} />
          )}
        </>
      )}
    </Stack>
  );
}

/** The member view's single-line card: the picked team's direct members over cycles. */
function MemberTrendCard({ series, metric }: { series: PulseTrendResponse; metric: TrendMetric }) {
  const { t } = useTranslation();
  const def = {
    name: trendSeriesKey(series),
    label: t("pulse.trend.series.own"),
    color: "lettuce.6",
  };
  const rows = buildTrendComparisonRows([series], metric);
  const renderableRows = rows.filter((row) => row[def.name] != null);
  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        {renderableRows.length >= 2 ? (
          <Suspense fallback={<Skeleton height={260} radius="sm" />}>
            <PulseTrendChart data={rows} series={[def]} yDomain={trendMetricDomain(metric)} />
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
