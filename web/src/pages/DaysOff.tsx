import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { getDaysOffCalendar, type DaysOffCalendarScope } from "../api/daysoff";
import DaysOffBudgetCard from "../components/DaysOffBudgetCard";
import DaysOffBudgetsTable from "../components/DaysOffBudgetsTable";
import DaysOffMonthGrid from "../components/DaysOffMonthGrid";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import { useIsManager } from "../hooks/useIsManager";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
import { addIsoMonths, currentIsoMonth, formatIsoMonth } from "../utils/datetime";
import { daysOffCreateLink, daysOffListLink } from "../utils/daysOffLinks";
import DaysOffTable from "./DaysOffTable";
import { loadErrorMessage } from "../utils/saveError";
import EmptyCtaLink from "../components/EmptyCtaLink";
import TutorialButton from "../components/TutorialButton";

const TEAM_VIEWS = ["requests", "budgets"] as const;
type TeamView = (typeof TEAM_VIEWS)[number];
import PageHeader from "../components/PageHeader";

const TABS = ["calendar", "requests", "team"] as const;
type DaysOffTab = (typeof TABS)[number];
// The stored calendar scope pick: "managed" and "managedAll" both hit the API's scope=managed,
// differing only in includeIndirect — a stored pre-v3.13.0 "managed" keeps working as the
// direct-reports pick.
const SCOPES = ["member", "managed", "managedAll"] as const;

function isDaysOffTab(value: string | null): value is DaysOffTab {
  return TABS.includes(value as DaysOffTab);
}

function CalendarTab({ isManager }: { isManager: boolean }) {
  const { t, i18n } = useTranslation();
  // The month is deliberately not persisted — a calendar visit starts at "now".
  const [month, setMonth] = useState(currentIsoMonth());
  const [storedScope, setScope] = useStoredState<(typeof SCOPES)[number]>(
    "daysOff.calendar.scope", "member", isOneOf(SCOPES),
  );
  // A stored managed/managedAll scope degrades gracefully if the caller stops managing.
  const effectiveScope = isManager ? storedScope : "member";
  const scope: DaysOffCalendarScope = effectiveScope === "member" ? "member" : "managed";
  // v3.13.0: "managedAll" widens the managed scope to the caller's whole transitive chain.
  const includeIndirect = effectiveScope === "managedAll";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["daysOffCalendar", scope, month, includeIndirect],
    queryFn: () => getDaysOffCalendar(month, scope, includeIndirect)
  });

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="xs" align="center" data-tour="days-off-month">
          <ActionIcon
            variant="default"
            onClick={() => setMonth((m) => addIsoMonths(m, -1))}
            aria-label={t("daysOff.calendar.previousMonth")}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={600} w={150} ta="center">
            {formatIsoMonth(month, i18n.language)}
          </Text>
          <ActionIcon
            variant="default"
            onClick={() => setMonth((m) => addIsoMonths(m, 1))}
            aria-label={t("daysOff.calendar.nextMonth")}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        {isManager && (
          <Select
            label={t("daysOff.calendar.scope")}
            data={SCOPES.map((s) => ({ value: s, label: t(`daysOff.calendar.scope_${s}`) }))}
            value={storedScope}
            onChange={(v) => v && setScope(v as (typeof SCOPES)[number])}
            allowDeselect={false}
            // Wide enough for the longest option in either language ("All my reports
            // (including indirect)" / "Wszyscy moi podwładni (także pośredni)").
            w={{ base: "100%", sm: 330 }}
            // Mantine 9.6 spreads unknown Select props onto the <input> — the guided-tour
            // anchor must ride wrapperProps or it would land on the input, not the label+input
            // pair the tutorial spotlights.
            wrapperProps={{ "data-tour": "days-off-calendar-scope" }}
          />
        )}
      </Group>

      {isError ? (
        <Alert color="red" variant="light" title={t("daysOff.calendar.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      ) : isLoading || !data ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : data.users.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("daysOff.calendar.empty")}
        </Text>
      ) : (
        <DaysOffMonthGrid data={data} showTeams={scope === "managed"} />
      )}
    </Stack>
  );
}

/**
 * The nav "Days off" page: the team calendar (member scope for everyone, managed scope for
 * managers — widenable to the caller's whole transitive chain since v3.13.0), the caller's own
 * entries + budget, and — managers only — the direct reports' (or, with the "Reports" scope
 * widened, the whole chain's) entries and budgets. No approval lifecycle since v3.9.0 — every
 * entry is active from creation; the only per-row action is Delete.
 */
export default function DaysOff() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [teamView, setTeamView] = useStoredState<TeamView>("daysOff.team.view", "requests", isOneOf(TEAM_VIEWS));
  // The team tab's Reports scope (v3.13.0) — direct reports by default, widened to the whole
  // transitive chain; drives both the entries list and the budgets table below.
  const [reportsScope, setReportsScope] = useStoredState<"direct" | "all">(
    "daysOff.team.reportsScope", "direct", isOneOf(["direct", "all"] as const),
  );
  const includeIndirect = reportsScope === "all";
  const isManager = useIsManager();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  const requestedTab = searchParams.get("tab");
  const activeTab: DaysOffTab =
    isDaysOffTab(requestedTab) && (requestedTab !== "team" || isManager)
      ? requestedTab
      : "calendar";

  function selectTab(value: string | null) {
    if (!isDaysOffTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t("daysOff.sectionTitle")}
        actions={
          <>
            {isManager && (
              <Button
                component={RouterLink}
                to={daysOffCreateLink(daysOffListLink("team"), true)}
                variant="default"
                leftSection={<IconPlus size={16} />}
                data-tour="days-off-record"
              >
                {t("daysOff.newForReport")}
              </Button>
            )}
            <Button
              component={RouterLink}
              to={daysOffCreateLink(daysOffListLink("requests"))}
              leftSection={<IconPlus size={16} />}
              data-tour="days-off-new"
            >
              {t("daysOff.newRequest")}
            </Button>
            <TutorialButton id="daysOff" tourId="days-off-tutorial" />
          </>
        }
      />
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="calendar" data-tour="days-off-calendar">
            {t("daysOff.tab.calendar")}
          </Tabs.Tab>
          <Tabs.Tab value="requests" data-tour="days-off-requests">
            {t("daysOff.tab.requests")}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="team" data-tour="days-off-team">
              {t("daysOff.tab.team")}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="calendar" pt="md">
          <CalendarTab isManager={isManager} />
        </Tabs.Panel>

        <Tabs.Panel value="requests" pt="md">
          <Stack gap="md">
            <DaysOffBudgetCard year={new Date().getFullYear()} tourId="days-off-budget" />
            <DaysOffTable
              view="own"
              emptyAction={
                <EmptyCtaLink to={daysOffCreateLink(daysOffListLink("requests"))}>{t("daysOff.emptyCta")}</EmptyCtaLink>
              }
            />
          </Stack>
        </Tabs.Panel>

        {isManager && (
          <Tabs.Panel value="team" pt="md">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" gap="sm">
                <Text size="sm" c="dimmed" maw={720}>
                  {t("daysOff.teamHint")}
                </Text>
                {/* Requests | Budgets (v3.4.0) plus the Reports scope (v3.13.0), right-aligned
                    together so the Select's label doesn't misalign the segmented control. */}
                <Group gap="sm" align="flex-end">
                  {/* A flex item shrinks the Select to its intrinsic width and clips the
                      longest option; the Box gives it the room the FilterPanel grid gives
                      the same control elsewhere. */}
                  <Box w={{ base: "100%", sm: 300 }}>
                    <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
                  </Box>
                  <SegmentedControl
                    aria-label={t("daysOff.teamView.label")}
                    value={teamView}
                    onChange={(v) => setTeamView(v as TeamView)}
                    data={TEAM_VIEWS.map((v) => ({ value: v, label: t(`daysOff.teamView.${v}`) }))}
                    data-tour="days-off-team-view"
                  />
                </Group>
              </Group>
              {teamView === "requests" ? (
                <DaysOffTable view="managed" includeIndirect={includeIndirect} />
              ) : (
                <DaysOffBudgetsTable includeIndirect={includeIndirect} />
              )}
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
