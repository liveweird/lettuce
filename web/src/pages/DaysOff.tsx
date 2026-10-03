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
  Text,
  Tooltip
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconPlus, IconShare } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { canAudit, getUserId, hasFeature } from "../api/session";
import { getDaysOffCalendar, type DaysOffCalendarScope, type DaysOffCalendarUser } from "../api/daysoff";
import { listAllTeams } from "../api/teams";
import DaysOffBudgetCard from "../components/DaysOffBudgetCard";
import DaysOffBudgetsTable from "../components/DaysOffBudgetsTable";
import DaysOffMonthGrid from "../components/DaysOffMonthGrid";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import ShareDialog from "../components/ShareDialog";
import { useIsManager } from "../hooks/useIsManager";
import { isNumberOrNull, isOneOf, useStoredState } from "../hooks/useStoredState";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { addIsoMonths, currentIsoMonth, formatIsoMonth } from "../utils/datetime";
import { daysOffCreateLink, daysOffListLink, daysOffMassShareLink } from "../utils/daysOffLinks";
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
// direct-reports pick. "org" (v3.25.0, HR auditor only) hits the API's scope=org. "shared"
// (v4.11.0, "Shared with me" — offered to everyone) hits scope=shared: the people whose calendar
// was shared with the caller.
const SCOPES = ["member", "shared", "managed", "managedAll", "org"] as const;
type CalendarScopePick = (typeof SCOPES)[number];
const API_SCOPE: Record<CalendarScopePick, DaysOffCalendarScope> = {
  member: "member",
  shared: "shared",
  managed: "managed",
  managedAll: "managed",
  org: "org",
};

function isDaysOffTab(value: string | null): value is DaysOffTab {
  return TABS.includes(value as DaysOffTab);
}

function CalendarTab({ isManager }: { isManager: boolean }) {
  const { t, i18n } = useTranslation();
  const auditor = canAudit();
  const currentUserId = getUserId();
  const [searchParams, setSearchParams] = useSearchParams();
  // The month is deliberately not persisted — a calendar visit starts at "now".
  const [month, setMonth] = useState(currentIsoMonth());
  const [storedScope, setScope] = useStoredState<CalendarScopePick>(
    "daysOff.calendar.scope", "member", isOneOf(SCOPES),
  );
  // "Shared with me" is offered to everyone (v4.11.0); managed/managedAll need a managed team and
  // "org" the HR auditor role.
  const availableScopes = SCOPES.filter((s) => {
    if (s === "org") return auditor;
    if (s === "managed" || s === "managedAll") return isManager;
    return true;
  });
  // A stored "org" scope must never apply to a non-auditor (a role downgrade, or a stale
  // cross-device value) — fall back to the member scope, without rewriting storage (the
  // PulseResults role-downgrade idiom); a stored managed/managedAll scope likewise degrades
  // gracefully if the caller stops managing. An explicit ?scope= (the notification / Shared-screen
  // deep link, v4.11.0) wins over the stored pick when the caller may use it — the `dashboard.tab`
  // idiom; picking in the Select drops it from the URL again.
  const requestedScope = searchParams.get("scope");
  const urlScope = availableScopes.find((s) => s === requestedScope);
  const safeScope: CalendarScopePick = urlScope ?? (availableScopes.includes(storedScope) ? storedScope : "member");
  // `?user=<id>` highlights (and scrolls to) one row of the grid — the sharer's link target.
  const requestedUser = searchParams.get("user");
  const highlightUserId = requestedUser != null && /^\d+$/.test(requestedUser) ? Number(requestedUser) : null;

  const scope = API_SCOPE[safeScope];
  // v3.13.0: "managedAll" widens the managed scope to the caller's whole transitive chain.
  const includeIndirect = safeScope === "managedAll";

  // The one Share dialog of the page (D6, v4.11.0): `opened` flips off on close while the target
  // stays set, so the dialog can animate out over the same person.
  const [shareFor, setShareFor] = useState<{ userId: number; opened: boolean } | null>(null);

  function pickScope(next: CalendarScopePick) {
    setScope(next);
    setSearchParams(
      (params) => {
        params.delete("scope");
        params.delete("user");
        return params;
      },
      { replace: true },
    );
  }

  function shareAction(user: DaysOffCalendarUser) {
    if (!user.canShareCalendar) return null;
    const own = user.userId === currentUserId;
    const label = own
      ? t("daysOff.calendar.shareOwnAria")
      : t("daysOff.calendar.shareAria", { name: user.userName });
    return (
      <Tooltip label={t("sharing.button")} withArrow>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={label}
          onClick={() => setShareFor({ userId: user.userId, opened: true })}
        >
          <IconShare size={14} />
        </ActionIcon>
      </Tooltip>
    );
  }

  // The org-scope team narrower (v3.25.0): every team, from the shared all-teams pool.
  const [storedOrgTeamId, setOrgTeamId] = useStoredState<number | null>(
    "daysOff.calendar.orgTeam", null, isNumberOrNull,
  );
  const teamsQuery = useQuery({
    queryKey: ["teams", "all"],
    queryFn: () => listAllTeams(),
    enabled: scope === "org",
  });
  // A deleted team must never pin the calendar to an empty result — validate the stored pick
  // against the fetched teams, but only ONCE they have arrived: dropping to "All teams" while
  // the list loads would fire a second, wider calendar request and flash the wrong scope.
  const orgTeamId =
    storedOrgTeamId == null || teamsQuery.data == null
      ? storedOrgTeamId
      : teamsQuery.data.some((team) => team.id === storedOrgTeamId)
        ? storedOrgTeamId
        : null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["daysOffCalendar", scope, month, includeIndirect, scope === "org" ? orgTeamId : undefined],
    queryFn: () =>
      getDaysOffCalendar(month, scope, {
        includeIndirect,
        teamId: scope === "org" ? (orgTeamId ?? undefined) : undefined,
      }),
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
        {/* Offered to everyone since v4.11.0 — "Shared with me" is a scope every caller has. */}
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select
            label={t("daysOff.calendar.scope")}
            data={availableScopes.map((s) => ({ value: s, label: t(`daysOff.calendar.scope_${s}`) }))}
            value={safeScope}
            onChange={(v) => v && pickScope(v as CalendarScopePick)}
            allowDeselect={false}
            // Wide enough for the longest option in either language ("All my reports
            // (including indirect)" / "Wszyscy moi podwładni (także pośredni)").
            w={{ base: "100%", sm: 330 }}
            // Mantine 9.6 spreads unknown Select props onto the <input> — the guided-tour
            // anchor must ride wrapperProps or it would land on the input, not the label+input
            // pair the tutorial spotlights.
            wrapperProps={{ "data-tour": "days-off-calendar-scope" }}
          />
          {scope === "org" && (
            <Select
              label={t("daysOff.calendar.orgTeamLabel")}
              data={[
                { value: "", label: t("daysOff.calendar.orgTeamAll") },
                ...(teamsQuery.data ?? []).map((team) => ({ value: String(team.id), label: team.name })),
              ]}
              value={orgTeamId == null ? "" : String(orgTeamId)}
              onChange={(v) => setOrgTeamId(v == null || v === "" ? null : Number(v))}
              allowDeselect={false}
              searchable
              // A Select in a flex Group clips its longest option unless it gets an
              // explicit width.
              w={{ base: "100%", sm: 260 }}
            />
          )}
        </Group>
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
          {t(
            scope === "org"
              ? "daysOff.calendar.emptyOrg"
              : scope === "shared"
                ? "daysOff.calendar.emptyShared"
                : "daysOff.calendar.empty",
          )}
        </Text>
      ) : (
        <DaysOffMonthGrid
          data={data}
          showTeams={scope !== "member"}
          renderRowAction={shareAction}
          highlightUserId={highlightUserId}
        />
      )}
      {shareFor != null && (
        <ShareDialog
          opened={shareFor.opened}
          onClose={() => setShareFor({ ...shareFor, opened: false })}
          resourceType="DAYS_OFF_CALENDAR"
          resourceId={shareFor.userId}
        />
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
  const here = useCurrentPath();
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
      // The calendar's deep-link params (v4.11.0) belong to the Calendar tab only.
      params.delete("scope");
      params.delete("user");
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
                to={daysOffCreateLink(daysOffListLink("team"), true, here)}
                variant="default"
                leftSection={<IconPlus size={16} />}
                data-tour="days-off-record"
              >
                {t("daysOff.newForReport")}
              </Button>
            )}
            <Button
              component={RouterLink}
              to={daysOffCreateLink(daysOffListLink("requests"), undefined, here)}
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
                  {/* The calendars mass-share entry (v4.11.0) — managers only, like the tab itself. */}
                  <Button
                    component={RouterLink}
                    to={daysOffMassShareLink()}
                    variant="default"
                    leftSection={<IconShare size={16} />}
                  >
                    {t("daysOff.teamShareButton")}
                  </Button>
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
