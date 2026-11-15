import {
  Suspense,
  useEffect,
  useState,
} from "react";
import { ActionIcon, AppShell, Burger, Group, ScrollArea, Text, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import {
  Navigate,
  Outlet,
  Route,
  useLocation,
  useNavigate,
  useParams,
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature, isAdmin } from "./api/session";
import { logout } from "./api/auth";
import { RedirectIfAuthed, RequireAuth, flagSignedOut } from "./auth";
import AlertsBanner from "./components/AlertsBanner";
import { ALERTS_BAR_HEIGHT, useVisibleAlerts } from "./hooks/useVisibleAlerts";
import BrandLogo from "./components/BrandLogo";
import NotificationsButton from "./components/NotificationsButton";
import CommandPalette from "./components/CommandPalette";
import UserMenu from "./components/UserMenu";
import { useChangelogUnseen } from "./hooks/useChangelogSeen";
import { isBoolean, useStoredState } from "./hooks/useStoredState";
import { useIsManager } from "./hooks/useIsManager";
import { usePageTitleAndFocus } from "./hooks/usePageTitleAndFocus";
import { IntentPreloadContext } from "./hooks/useIntentPreload";
import { preloadRoute } from "./routePreload";
import { TourProvider } from "./components/Tour";
import ErrorBoundary, { RouteErrorBoundary } from "./components/ErrorBoundary";
import TelemetryPanelCrash from "./components/TelemetryPanelCrash";
import { setTelemetryPanelOpen, useTelemetryPanelOpen } from "./hooks/useTelemetryPanel";
import CenteredLoader from "./components/CenteredLoader";
import { AppNav, NavFooter } from "./appShell/AppNav";
import { activeLeaf, resolveNav } from "./appShell/navModel";
import { HEADER_HEIGHT, NAV_WIDTH, RAIL_WIDTH } from "./appShell/layout";
import lazyPage from "./lazyPage";
// The ADMIN telemetry panel (v4.20.0): a lazy chunk a non-admin never downloads (it is mounted only for an ADMIN with the panel open).
const TelemetryPanel = lazyPage(() => import("./components/TelemetryPanel"));
const Dashboard = lazyPage(() => import("./pages/Dashboard"));
const Feedback = lazyPage(() => import("./pages/Feedback"));
const Kudos = lazyPage(() => import("./pages/Kudos"));
const CreateFeedback = lazyPage(() => import("./pages/CreateFeedback"));
const RequestFeedback = lazyPage(() => import("./pages/RequestFeedback"));
const AskFeedback = lazyPage(() => import("./pages/AskFeedback"));
const EditFeedback = lazyPage(() => import("./pages/EditFeedback"));
const ViewFeedback = lazyPage(() => import("./pages/ViewFeedback"));
const ManagerFeedbacks = lazyPage(() => import("./pages/ManagerFeedbacks"));
const UserOneOnOnes = lazyPage(() => import("./pages/UserOneOnOnes"));
const OneOnOnes = lazyPage(() => import("./pages/OneOnOnes"));
const CreateOneOnOne = lazyPage(() => import("./pages/CreateOneOnOne"));
const EditOneOnOne = lazyPage(() => import("./pages/EditOneOnOne"));
const ViewOneOnOne = lazyPage(() => import("./pages/ViewOneOnOne"));
const UserGoals = lazyPage(() => import("./pages/UserGoals"));
const MyGoals = lazyPage(() => import("./pages/MyGoals"));
const CreateGoal = lazyPage(() => import("./pages/CreateGoal"));
const EditGoal = lazyPage(() => import("./pages/EditGoal"));
const ViewGoal = lazyPage(() => import("./pages/ViewGoal"));
const ImpactLog = lazyPage(() => import("./pages/ImpactLog"));
const UserImpactLog = lazyPage(() => import("./pages/UserImpactLog"));
const CreateImpactEntry = lazyPage(() => import("./pages/CreateImpactEntry"));
const EditImpactEntry = lazyPage(() => import("./pages/EditImpactEntry"));
const ViewImpactEntry = lazyPage(() => import("./pages/ViewImpactEntry"));
const SuccessionPlans = lazyPage(() => import("./pages/SuccessionPlans"));
const UserSuccessionPlans = lazyPage(() => import("./pages/UserSuccessionPlans"));
const CreateSuccessionPlan = lazyPage(() => import("./pages/CreateSuccessionPlan"));
const ReviewSuccessionPlan = lazyPage(() => import("./pages/ReviewSuccessionPlan"));
const EditSuccessionNomination = lazyPage(() => import("./pages/EditSuccessionNomination"));
const MyTeamKpis = lazyPage(() => import("./pages/MyTeamKpis"));
const CreateTeamKpi = lazyPage(() => import("./pages/CreateTeamKpi"));
const EditTeamKpi = lazyPage(() => import("./pages/EditTeamKpi"));
const ViewTeamKpi = lazyPage(() => import("./pages/ViewTeamKpi"));
const TeamKpis = lazyPage(() => import("./pages/TeamKpis"));
const Performance = lazyPage(() => import("./pages/Performance"));
const Career = lazyPage(() => import("./pages/Career"));
const UserPerformanceReviews = lazyPage(() => import("./pages/UserPerformanceReviews"));
const CreatePerformanceReview = lazyPage(() => import("./pages/CreatePerformanceReview"));
const EditPerformanceReview = lazyPage(() => import("./pages/EditPerformanceReview"));
const ViewPerformanceReview = lazyPage(() => import("./pages/ViewPerformanceReview"));
const MassSharePerformanceReviews = lazyPage(() => import("./pages/MassSharePerformanceReviews"));
const MassShareDaysOffCalendars = lazyPage(() => import("./pages/MassShareDaysOffCalendars"));
const ReviewPeriods = lazyPage(() => import("./pages/ReviewPeriods"));
const DaysOff = lazyPage(() => import("./pages/DaysOff"));
const CreateDaysOff = lazyPage(() => import("./pages/CreateDaysOff"));
const UserDaysOff = lazyPage(() => import("./pages/UserDaysOff"));
const UserCareer = lazyPage(() => import("./pages/UserCareer"));
const Pulse = lazyPage(() => import("./pages/Pulse"));
const PulseCycles = lazyPage(() => import("./pages/PulseCycles"));
const PublicHolidays = lazyPage(() => import("./pages/PublicHolidays"));
const DaysOffPoolTypes = lazyPage(() => import("./pages/DaysOffPoolTypes"));
const Login = lazyPage(() => import("./pages/Login"));
const ResetPassword = lazyPage(() => import("./pages/ResetPassword"));
const CreateUser = lazyPage(() => import("./pages/CreateUser"));
const ImportUsers = lazyPage(() => import("./pages/ImportUsers"));
const EditUser = lazyPage(() => import("./pages/EditUser"));
const ChangeUserPassword = lazyPage(() => import("./pages/ChangeUserPassword"));
const NotificationPreferences = lazyPage(() => import("./pages/NotificationPreferences"));
const UserFeatures = lazyPage(() => import("./pages/UserFeatures"));
const FeatureFlags = lazyPage(() => import("./pages/FeatureFlags"));
const IntegrationClients = lazyPage(() => import("./pages/IntegrationClients"));
const UserTeams = lazyPage(() => import("./pages/UserTeams"));
const UserDetails = lazyPage(() => import("./pages/UserDetails"));
const CreateTeam = lazyPage(() => import("./pages/CreateTeam"));
const EditTeam = lazyPage(() => import("./pages/EditTeam"));
const Teams = lazyPage(() => import("./pages/Teams"));
const TeamDetails = lazyPage(() => import("./pages/TeamDetails"));
const TeamHistory = lazyPage(() => import("./pages/TeamHistory"));

// The team-details page's historical URLs: /teams/:id/members (renamed v2.5.7 — the page had
// been team details since v2.5.3) and /teams/:id/subordinates (merged in, v2.5.5). Both keep
// working via this redirect (there is no catch-all route); the query string is forwarded so
// back-origin links (?from=myTeams / ?from=org) survive.
function TeamDetailsRedirect() {
  const { teamId } = useParams<{ teamId: string }>();
  const { search } = useLocation();
  return <Navigate to={`/teams/${teamId}/details${search}`} replace />;
}

// The pre-v4.0.0 email-mirror screen's URL: notification preferences absorbed it, so this route
// stays as a redirect (the id preserved) rather than a dead link on any bookmark/menu-item cache.
function EmailNotificationsRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/users/${id}/notification-preferences`} replace />;
}
// Lazy like MarkdownEditor: @xyflow/react + dagre stay out of the main bundle.
const OrgChart = lazyPage(() => import("./pages/OrgChart"));
const Users = lazyPage(() => import("./pages/Users"));
const Templates = lazyPage(() => import("./pages/Templates"));
const CreateTemplate = lazyPage(() => import("./pages/CreateTemplate"));
const EditTemplate = lazyPage(() => import("./pages/EditTemplate"));
const ViewTemplate = lazyPage(() => import("./pages/ViewTemplate"));
const Alerts = lazyPage(() => import("./pages/Alerts"));
const Dictionary = lazyPage(() => import("./pages/Dictionary"));
const Changelog = lazyPage(() => import("./pages/Changelog"));
const Shares = lazyPage(() => import("./pages/Shares"));
const ActivityLog = lazyPage(() => import("./pages/ActivityLog"));
const UserActivity = lazyPage(() => import("./pages/UserActivity"));
const CreateAlert = lazyPage(() => import("./pages/CreateAlert"));
const EditAlert = lazyPage(() => import("./pages/EditAlert"));
const NotFound = lazyPage(() => import("./pages/NotFound"));

function RouteFallback() {
  return <CenteredLoader mih={200} />;
}


/**
 * Warms the lazy page a path renders (the nav's intent preload, hooks/useIntentPreload.ts). Defined here, next to the route
 * table, and handed down through context: the nav cannot import `appRoutes` — the table contains this Shell, which contains the
 * nav. Read at call time, so `appRoutes` being declared further down is fine.
 */
function warmRoute(to: string) {
  void preloadRoute(appRoutes, to);
}

function Shell() {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure();
  // The mobile overlay only ever opens below the navbar breakpoint, but nothing but
  // navigation used to close it — so opening it and then widening past `sm` left `opened`
  // true and defeated the icon rail below. Crossing above the breakpoint closes it.
  const mantineTheme = useMantineTheme();
  const aboveNavBreakpoint = useMediaQuery(`(min-width: ${mantineTheme.breakpoints.sm})`);
  useEffect(() => {
    if (aboveNavBreakpoint) close();
  }, [aboveNavBreakpoint, close]);
  // Desktop navbar visibility — device-level, persisted like the other view settings. The
  // mobile overlay keeps its own separate `opened` disclosure above.
  const [navCollapsed, setNavCollapsed] = useStoredState("appShell.navCollapsed", false, isBoolean);
  // The one async nav gate (v2.42.0): the Succession leaf is manager-only.
  const isManager = useIsManager();
  const navigate = useNavigate();
  const userId = getUserId();
  const { pathname } = useLocation();
  // Document title from the page's h1 + focus to it on a route change (v4.21.0, WCAG 2.4.2).
  usePageTitleAndFocus(pathname, t("appShell.brand"));
  // The grouped navigation (v3.3.0, appShell/navModel.ts): feature/manager/admin gates applied
  // BEFORE the active-leaf lookup, so active-highlight stays coherent.
  const nav = resolveNav({ isAdmin: isAdmin(), isManager, hasFeature }, userId);
  const changelogUnseen = useChangelogUnseen();
  const activeTo = activeLeaf(nav.leafTos, pathname);
  // The icon rail: the desktop toggle narrows the navbar to icons; the mobile overlay keeps
  // full labels (`opened` is only ever true below the sm breakpoint, where the Burger lives).
  const rail = navCollapsed && !opened;
  // The telemetry panel: the stored flag is device-level, but a stored `true` shows nothing to a non-admin.
  const panelStored = useTelemetryPanelOpen();
  const showPanel = isAdmin() && panelStored;
  const closePanel = () => setTelemetryPanelOpen(false);
  // Below `lg` the panel covers the page edge to edge: the covered navbar and page are inert (out of the tab order and the
  // accessibility tree) while it is open; the header stays usable.
  const panelBesidePage = useMediaQuery(`(min-width: ${mantineTheme.breakpoints.lg})`, true, { getInitialValueInEffect: false });
  const pageCovered = showPanel && !panelBesidePage;

  async function handleLogout() {
    flagSignedOut();
    const revoke = logout();
    navigate("/login", { replace: true });
    await revoke;
  }

  // While any alerts are visible, the banner strip occupies a permanent row above the header;
  // AppShell propagates the total height into navbar/main offsets automatically.
  const { data: visibleAlerts } = useVisibleAlerts();
  const alertsBarHeight = (visibleAlerts ?? []).length > 0 ? ALERTS_BAR_HEIGHT : 0;

  return (
    // The tour targets navbar items — expanding on start keeps every step's anchor visible.
    <IntentPreloadContext.Provider value={warmRoute}>
    <TourProvider onStart={() => setNavCollapsed(false)}>
    <AppShell
      header={{ height: HEADER_HEIGHT + alertsBarHeight }}
      navbar={{
        width: { base: NAV_WIDTH, sm: rail ? RAIL_WIDTH : NAV_WIDTH },
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: false },
      }}
      // 420 px beside the page from `lg` up; below it the panel covers the page edge to edge (a pushed 420 px next to the navbar
      // would leave a sliver). Collapsed by default: with the stored flag false nothing is rendered or reserved.
      aside={{ width: 420, breakpoint: "lg", collapsed: { desktop: !showPanel, mobile: !showPanel } }}
      padding="md"
    >
      <AppShell.Header>
        <a href="#main-content" className="skip-link">
          {t("appShell.skipToContent")}
        </a>
        <AlertsBanner />
        <Group h={HEADER_HEIGHT} px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={t("appShell.toggleMobileNav")}
              aria-expanded={opened}
            />
            {/* A sidebar glyph, not a Burger: the Burger's open state renders a permanent "X"
                in the header corner, which reads as "close the app". data-expanded backs the
                shell test's state assertion. */}
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              visibleFrom="sm"
              onClick={() => setNavCollapsed(!navCollapsed)}
              aria-label={t("appShell.toggleNav")}
              data-expanded={!navCollapsed || undefined}
            >
              {navCollapsed ? (
                <IconLayoutSidebarLeftExpand size={18} />
              ) : (
                <IconLayoutSidebarLeftCollapse size={18} />
              )}
            </ActionIcon>
            <BrandLogo />
            <Text fw={600} size="md" visibleFrom="sm">
              {t("appShell.brand")}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <CommandPalette nav={nav} />
            <span data-tour="notifications" style={{ display: "inline-flex" }}>
              <NotificationsButton />
            </span>
            <UserMenu onLogout={handleLogout} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={rail ? "xs" : "sm"} inert={pageCovered}>
        {/* The link list scrolls when expanded groups outgrow the viewport (min-height 0 lets
            the flex child actually shrink — without it the list grew under the pinned footer
            and the last leaves looked clipped); the footer below stays pinned. */}
        <AppShell.Section
          grow
          component={ScrollArea}
          type="hover"
          scrollbarSize={6}
          offsetScrollbars
          style={{ minHeight: 0 }}
        >
          <AppNav sections={nav.sections} activeTo={activeTo} rail={rail} onNavigate={close} />
        </AppShell.Section>
        <NavFooter
          items={nav.footer}
          activeTo={activeTo}
          rail={rail}
          changelogUnseen={changelogUnseen}
          onNavigate={close}
        />
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1} inert={pageCovered}>
        {/* A page crash stays inside the main area — header/nav keep working, and navigating
            anywhere remounts the boundary (see components/ErrorBoundary.tsx). The inner
            Suspense (v2.24.0) keeps the shell mounted while a lazy page chunk loads — the
            App-level fallback used to blank the whole chrome on every route transition. */}
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </AppShell.Main>

      {showPanel && (
        <AppShell.Aside aria-label={t("telemetry.title")}>
          {/* Outside every route boundary: its own, with a way to close it (the open flag survives a reload). */}
          <ErrorBoundary fallback={<TelemetryPanelCrash onClose={closePanel} />}>
            <Suspense fallback={<CenteredLoader />}>
              <TelemetryPanel onClose={closePanel} />
            </Suspense>
          </ErrorBoundary>
        </AppShell.Aside>
      )}
    </AppShell>
    </TourProvider>
    </IntentPreloadContext.Provider>
  );
}

/** The root layout: one Suspense around the whole tree so every lazy page shares the fallback. */
function RootLayout() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  );
}

/**
 * The application's route tree (v3.6.0 — a DATA router): `main.tsx` mounts it through
 * `createBrowserRouter` + `RouterProvider`, the shell tests through `createMemoryRouter`
 * (`test/render.tsx` `renderAppAt`). A data router is what lets `components/DiscardGuard`
 * hold in-app navigation away from a dirty form (`useBlocker`).
 */
export const appRoutes = createRoutesFromElements(
  <Route element={<RootLayout />}>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/reset-password"
          element={
            <RedirectIfAuthed>
              <ResetPassword />
            </RedirectIfAuthed>
          }
        />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="users/new" element={<CreateUser />} />
            <Route path="users/import" element={<ImportUsers />} />
            <Route path="users/:id/edit" element={<EditUser />} />
            <Route path="users/:id/change-password" element={<ChangeUserPassword />} />
            <Route
              path="users/:id/email-notifications"
              element={<EmailNotificationsRedirect />}
            />
            <Route
              path="users/:id/notification-preferences"
              element={<NotificationPreferences />}
            />
            <Route path="users/:id/features" element={<UserFeatures />} />
            <Route path="feature-flags" element={<FeatureFlags />} />
            <Route path="integration-clients" element={<IntegrationClients />} />
            <Route path="users/:id/teams" element={<UserTeams />} />
            <Route path="users/:userId/details" element={<UserDetails />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/new" element={<CreateTeam />} />
            <Route path="teams/:id/edit" element={<EditTeam />} />
            <Route path="teams/:id/details" element={<TeamDetails />} />
            <Route path="teams/:id/history" element={<TeamHistory />} />
            <Route path="teams/:teamId/members" element={<TeamDetailsRedirect />} />
            <Route path="teams/:teamId/subordinates" element={<TeamDetailsRedirect />} />
            <Route path="org" element={<OrgChart />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="kudos" element={<Kudos />} />
            <Route path="kudos/new" element={<CreateFeedback kudo />} />
            <Route path="feedback/new" element={<CreateFeedback />} />
            <Route path="feedback/request" element={<RequestFeedback />} />
            <Route path="feedback/ask" element={<AskFeedback />} />
            <Route path="feedback/:id/edit" element={<EditFeedback />} />
            <Route path="feedback/:id/view" element={<ViewFeedback />} />
            <Route path="users/:userId/feedbacks" element={<ManagerFeedbacks />} />
            <Route path="users/:userId/one-on-ones" element={<UserOneOnOnes />} />
            <Route path="one-on-ones" element={<OneOnOnes />} />
            <Route path="one-on-ones/new" element={<CreateOneOnOne />} />
            <Route path="one-on-ones/:id/edit" element={<EditOneOnOne />} />
            <Route path="one-on-ones/:id/view" element={<ViewOneOnOne />} />
            <Route path="users/:userId/goals" element={<UserGoals />} />
            <Route path="goals" element={<MyGoals />} />
            <Route path="goals/new" element={<CreateGoal />} />
            <Route path="goals/:id/edit" element={<EditGoal />} />
            <Route path="goals/:id/view" element={<ViewGoal />} />
            <Route path="impact-log" element={<ImpactLog />} />
            <Route path="users/:userId/impact-log" element={<UserImpactLog />} />
            <Route path="impact-log/new" element={<CreateImpactEntry />} />
            <Route path="impact-log/:id/edit" element={<EditImpactEntry />} />
            <Route path="impact-log/:id/view" element={<ViewImpactEntry />} />
            <Route path="succession" element={<SuccessionPlans />} />
            <Route path="users/:userId/succession" element={<UserSuccessionPlans />} />
            <Route path="succession/new" element={<CreateSuccessionPlan />} />
            <Route path="succession/:id/view" element={<ReviewSuccessionPlan />} />
            <Route path="succession/:id/nominations/new" element={<EditSuccessionNomination />} />
            <Route path="succession/:id/nominations/:nominationId/edit" element={<EditSuccessionNomination />} />
            <Route path="team-kpis" element={<MyTeamKpis />} />
            <Route path="team-kpis/new" element={<CreateTeamKpi />} />
            <Route path="team-kpis/:id/edit" element={<EditTeamKpi />} />
            <Route path="team-kpis/:id/view" element={<ViewTeamKpi />} />
            <Route path="performance" element={<Performance />} />
            <Route path="career" element={<Career />} />
            {/* The pre-v1.45 URL of the own view — bookmarks/notification landings keep working. */}
            <Route path="my-performance" element={<Navigate to="/performance" replace />} />
            <Route path="users/:userId/performance-reviews" element={<UserPerformanceReviews />} />
            <Route path="performance-reviews/new" element={<CreatePerformanceReview />} />
            <Route path="performance-reviews/:id/edit" element={<EditPerformanceReview />} />
            <Route path="performance-reviews/:id/view" element={<ViewPerformanceReview />} />
            <Route path="performance-reviews/mass-share" element={<MassSharePerformanceReviews />} />
            <Route path="review-periods" element={<ReviewPeriods />} />
            <Route path="pulse" element={<Pulse />} />
            <Route path="pulse-cycles" element={<PulseCycles />} />
            <Route path="days-off" element={<DaysOff />} />
            <Route path="days-off/new" element={<CreateDaysOff />} />
            <Route path="days-off/mass-share" element={<MassShareDaysOffCalendars />} />
            <Route path="users/:userId/days-off" element={<UserDaysOff />} />
            <Route path="users/:userId/career" element={<UserCareer />} />
            <Route path="public-holidays" element={<PublicHolidays />} />
            <Route path="days-off-pools" element={<DaysOffPoolTypes />} />
            <Route path="teams/:teamId/kpis" element={<TeamKpis />} />
            <Route path="templates" element={<Templates />} />
            <Route path="templates/new" element={<CreateTemplate />} />
            <Route path="templates/:id/edit" element={<EditTemplate />} />
            <Route path="templates/:id/view" element={<ViewTemplate />} />
            <Route path="dictionaries/:slug" element={<Dictionary />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="alerts/new" element={<CreateAlert />} />
            <Route path="alerts/:id/edit" element={<EditAlert />} />
            <Route path="shares" element={<Shares />} />
            <Route path="activity" element={<ActivityLog />} />
            <Route path="users/:userId/activity" element={<UserActivity />} />
            <Route path="changelog" element={<Changelog />} />
            {/* The authenticated catch-all — an unmatched URL renders inside the shell. */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
  </Route>,
);

/** The app: the route tree on a browser data router (created once per mount). */
export default function App() {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return <RouterProvider router={router} />;
}
