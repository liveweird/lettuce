import { Alert, Group, SegmentedControl, Select, Skeleton, Stack } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../api/http";
import { canAudit, isHr } from "../api/session";
import {
  getPulseResults,
  getPulseVisibleTeams,
  listPulseCycles,
  type PulseAggregationMode,
  type PulseVisibleTeams,
} from "../api/pulse";
import { listShares, type ShareResponse } from "../api/shares";
import EmptyState from "../components/EmptyState";
import PulseTeamResultCard from "../components/PulseTeamResultCard";
import { useStoredState, isOneOf } from "../hooks/useStoredState";
import { closedCycleOptions } from "../utils/pulseResults";
import { isShareLapse } from "../utils/shareLapse";

// The v2.12.0 two-view layout: which teams are LISTED follows the view, not just how each
// card aggregates. "member" = teams the caller belongs to (always direct numbers); "managed"
// = the monitored tree, with its own direct/indirect calculation toggle. "shared" (v4.12.0) =
// the teams whose pulse results someone shared with the caller (fed by GET /shares, deduped by
// team) — offered to everyone, with the same calculation toggle. "all" (v3.24.0, HR-only via
// canAudit()) = every team in the org, fed by visible-teams' allTeams bucket — omitted for
// everyone else, so a non-auditor never sees the option.
const VIEWS = ["member", "managed", "shared", "all"] as const;
type ResultsView = (typeof VIEWS)[number];
// The order a bare `?team=` deep link (a sharer/author/activity-log "Open") looks for the team in.
const TEAM_LOOKUP_ORDER: readonly ResultsView[] = ["member", "managed", "all", "shared"];
const CALCS = ["direct", "indirect"] as const;
type ResultsCalc = (typeof CALCS)[number];

type SharedTeam = { id: number; name: string; sharedBy: string };

/**
 * Which view the page shows. An explicit `?view=` wins when the caller may use it (the days-off
 * calendar's `scope=` idiom — never rewriting the stored pick); a bare `?team=` picks the first
 * view holding the team; then the stored pick, with a stored "all" never applying to a non-auditor
 * (a role downgrade, or a stale cross-device value). A caller with no own/managed teams lands on
 * the org-wide auditor scope (HR) or, failing that, on the shared view when something is shared.
 */
function resolveView(input: {
  requestedView: string | null;
  teamParam: number | null;
  storedView: ResultsView;
  auditor: boolean;
  idsOf: Record<ResultsView, ReadonlySet<number>>;
  noOwnTeams: boolean;
  hasShared: boolean;
}): ResultsView {
  const { requestedView, teamParam, storedView, auditor, idsOf, noOwnTeams, hasShared } = input;
  const available = VIEWS.filter((v) => v !== "all" || auditor);
  const requested = available.find((v) => v === requestedView);
  if (requested != null) return requested;
  if (teamParam != null) {
    const holder = TEAM_LOOKUP_ORDER.find((v) => available.includes(v) && idsOf[v].has(teamParam));
    if (holder != null) return holder;
  }
  const safe: ResultsView = storedView === "all" && !auditor ? "member" : storedView;
  if (safe === "member" && noOwnTeams) {
    if (auditor) return "all";
    if (hasShared) return "shared";
  }
  return safe;
}

type TeamRef = { id: number; name: string };

/** One entry per shared team (the list is newest-first, so the first share names the sharer shown). */
function dedupeSharedTeams(items: ShareResponse[], unavailable: string): SharedTeam[] {
  const out: SharedTeam[] = [];
  for (const share of items) {
    if (out.some((team) => team.id === share.resourceId)) continue;
    out.push({ id: share.resourceId, name: share.details?.team ?? unavailable, sharedBy: share.sharerName });
  }
  return out;
}

/** The teams a view lists. */
function teamsOfView(view: ResultsView, teams: PulseVisibleTeams | undefined, shared: SharedTeam[]): TeamRef[] {
  if (view === "shared") return shared;
  const bucket = view === "member" ? teams?.memberTeams : view === "managed" ? teams?.monitoredTeams : teams?.allTeams;
  return bucket ?? [];
}

const EMPTY_KEY = {
  member: "pulse.view.noMemberTeams",
  managed: "pulse.view.noManagedTeams",
  shared: "pulse.view.noSharedTeams",
  all: "pulse.view.noAllTeams",
} as const satisfies Record<ResultsView, string>;

const idSet = (list: { id: number }[] | undefined) => new Set((list ?? []).map((team) => team.id));

/**
 * The "Results" tab: one card per team of the picked view for the picked CLOSED cycle. The
 * cycle pick follows `?cycle=` (the results-notification deep link) and defaults to the
 * latest closed cycle; the view and the calculation toggle persist per device. The per-cycle
 * fill gate surfaces as a single informational empty state, never as a wall of red cards.
 *
 * The gate is probed on a team that has NO active share with the caller (v4.12.0): a share-granted
 * read is decided by the SHARER's fill status, so it can neither prove nor disprove the caller's
 * own — only an own-right read can. Everything a share does answer is handled per card (the
 * "Shared by" line, the lapse copy), on whichever view the team sits.
 */
export default function PulseResults() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [searchParams, setSearchParams] = useSearchParams();
  const auditor = canAudit();
  const [storedView, setView] = useStoredState<ResultsView>("pulse.results.view", "member", isOneOf(VIEWS));
  const [calc, setCalc] = useStoredState<ResultsCalc>("pulse.results.calc", "direct", isOneOf(CALCS));

  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles });
  const teams = useQuery({ queryKey: ["pulseVisibleTeams"], queryFn: getPulseVisibleTeams });
  // Under the ["shares", …] prefix, so a share mutation (the card's Share dialog) refreshes it.
  const shares = useQuery({
    queryKey: ["shares", "withMe", "pulseTeamResults"],
    queryFn: () => listShares({ view: "withMe", resourceType: "PULSE_TEAM_RESULTS", status: "ACTIVE", pageSize: 100 }),
  });

  const options = closedCycleOptions(cycles.data ?? [], locale, t);
  const requested = searchParams.get("cycle");
  const selectedCycle =
    requested != null && options.some((o) => o.value === requested)
      ? Number(requested)
      : options.length > 0
        ? Number(options[0].value)
        : null;

  const sharedTeams = dedupeSharedTeams(shares.data?.items ?? [], t("sharing.doc.unavailable"));
  const sharedIds = idSet(sharedTeams);
  const monitoredIds = idSet(teams.data?.monitoredTeams);
  const noOwnTeams =
    teams.isSuccess && (teams.data.memberTeams?.length ?? 0) === 0 && (teams.data.monitoredTeams?.length ?? 0) === 0;
  const teamParam = searchParams.get("team");
  const highlightTeamId = teamParam != null && /^\d+$/.test(teamParam) ? Number(teamParam) : null;
  const view = resolveView({
    requestedView: searchParams.get("view"),
    teamParam: highlightTeamId,
    storedView,
    auditor,
    idsOf: {
      member: idSet(teams.data?.memberTeams),
      managed: monitoredIds,
      all: idSet(teams.data?.allTeams),
      shared: sharedIds,
    },
    noOwnTeams,
    hasShared: sharedTeams.length > 0,
  });
  const availableViews = VIEWS.filter((v) => v !== "all" || auditor);

  // The member view is always direct numbers; the other views follow the calc toggle.
  const viewTeams = teamsOfView(view, teams.data, sharedTeams);
  const wireMode: PulseAggregationMode = view !== "member" && calc === "indirect" ? "subtree" : "direct";
  // The fill-gate probe (own views only): the first team the caller has no active share on, so a
  // 200 is an own-right read and a plain 403 is the gate. It shares its query key with that team's
  // card, so no extra request. Waits for the shares list so it never picks a shared team.
  const probeTeam = view === "shared" ? undefined : viewTeams.find((team) => !sharedIds.has(team.id));
  const probe = useQuery({
    queryKey: ["pulseResults", selectedCycle, probeTeam?.id, wireMode],
    queryFn: () => getPulseResults(selectedCycle!, probeTeam!.id, wireMode),
    enabled: selectedCycle != null && probeTeam != null && !shares.isLoading,
    retry: false,
  });
  // A lapse 403 is a sharer's gate, not the caller's — the card words that one.
  const gated = probe.error instanceof ApiError && probe.error.status === 403 && !isShareLapse(probe.error);

  if (cycles.isLoading || teams.isLoading || shares.isLoading) return <Skeleton height={280} radius="md" />;
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

  const card = (team: TeamRef) => (
    <PulseTeamResultCard
      key={team.id}
      cycleId={selectedCycle!}
      teamId={team.id}
      teamName={team.name}
      mode={wireMode}
      canMonitor={isHr() || monitoredIds.has(team.id)}
      highlighted={team.id === highlightTeamId}
      sharedByFallback={view === "shared" ? sharedTeams.find((s) => s.id === team.id)?.sharedBy : undefined}
    />
  );
  // A fill-gated MONITOR (a manager who didn't respond) keeps their comments right — comments-only
  // cards for the monitored teams (view-independent: monitoring is a standing right, not a view
  // choice), except the teams of this view that were SHARED with the caller, which get full cards:
  // a share is decided by its sharer's fill status, not the caller's gate.
  const sharedInView = viewTeams.filter((team) => sharedIds.has(team.id));
  const commentsOnlyTeams = (teams.data?.monitoredTeams ?? []).filter(
    (team) => !sharedInView.some((s) => s.id === team.id),
  );

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
            onChange={(value) => {
              setView(value as ResultsView);
              // Picking a view drops the deep link's `view`/`team` (the stored pick takes over).
              setSearchParams(
                (params) => {
                  params.delete("view");
                  params.delete("team");
                  return params;
                },
                { replace: true },
              );
            }}
            data={availableViews.map((v) => ({ value: v, label: t(`pulse.view.${v}`) }))}
          />
          {view !== "member" && (
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
      {view === "shared" && shares.isError ? (
        <Alert color="red" variant="light">
          {t("pulse.error.loadFailed")}
        </Alert>
      ) : viewTeams.length === 0 ? (
        <EmptyState
          icon={<IconChartBar size={32} />}
          label={t(EMPTY_KEY[view])}
        />
      ) : gated ? (
        <>
          <EmptyState icon={<IconChartBar size={32} />} label={t("pulse.results.resultsGated")} />
          {selectedCycle != null &&
            commentsOnlyTeams.map((team) => (
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
          {selectedCycle != null && sharedInView.map(card)}
        </>
      ) : (
        selectedCycle != null && viewTeams.map(card)
      )}
    </Stack>
  );
}
