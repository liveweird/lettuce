import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Button,
  Group,
  Menu,
  ScrollArea,
  Text,
  useMantineColorScheme,
  useMantineTheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconChevronDown,
  IconHelp,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMail,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import {
  Link as RouterLink,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature, isAdmin } from "./api/session";
import { logout } from "./api/auth";
import { getCurrentUser } from "./api/users";
import { RedirectIfAuthed, RequireAuth, flagSignedOut, notifyAuthChange } from "./auth";
import AlertsBanner from "./components/AlertsBanner";
import { ALERTS_BAR_HEIGHT, useVisibleAlerts } from "./hooks/useVisibleAlerts";
import BrandLogo from "./components/BrandLogo";
import NotificationsButton from "./components/NotificationsButton";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useChangelogUnseen } from "./hooks/useChangelogSeen";
import { isBoolean, useStoredState } from "./hooks/useStoredState";
import { useIsManager } from "./hooks/useIsManager";
import { TourProvider } from "./components/Tour";
import { useTour } from "./components/tourSupport";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import CenteredLoader from "./components/CenteredLoader";
import { AppNav, NavFooter } from "./appShell/AppNav";
import { activeLeaf, resolveNav } from "./appShell/navModel";
import { HEADER_HEIGHT, NAV_WIDTH, RAIL_WIDTH } from "./appShell/layout";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Kudos = lazy(() => import("./pages/Kudos"));
const CreateFeedback = lazy(() => import("./pages/CreateFeedback"));
const RequestFeedback = lazy(() => import("./pages/RequestFeedback"));
const AskFeedback = lazy(() => import("./pages/AskFeedback"));
const EditFeedback = lazy(() => import("./pages/EditFeedback"));
const ViewFeedback = lazy(() => import("./pages/ViewFeedback"));
const ManagerFeedbacks = lazy(() => import("./pages/ManagerFeedbacks"));
const UserOneOnOnes = lazy(() => import("./pages/UserOneOnOnes"));
const OneOnOnes = lazy(() => import("./pages/OneOnOnes"));
const CreateOneOnOne = lazy(() => import("./pages/CreateOneOnOne"));
const EditOneOnOne = lazy(() => import("./pages/EditOneOnOne"));
const ViewOneOnOne = lazy(() => import("./pages/ViewOneOnOne"));
const UserGoals = lazy(() => import("./pages/UserGoals"));
const MyGoals = lazy(() => import("./pages/MyGoals"));
const CreateGoal = lazy(() => import("./pages/CreateGoal"));
const EditGoal = lazy(() => import("./pages/EditGoal"));
const ViewGoal = lazy(() => import("./pages/ViewGoal"));
const ImpactLog = lazy(() => import("./pages/ImpactLog"));
const UserImpactLog = lazy(() => import("./pages/UserImpactLog"));
const CreateImpactEntry = lazy(() => import("./pages/CreateImpactEntry"));
const EditImpactEntry = lazy(() => import("./pages/EditImpactEntry"));
const ViewImpactEntry = lazy(() => import("./pages/ViewImpactEntry"));
const SuccessionPlans = lazy(() => import("./pages/SuccessionPlans"));
const UserSuccessionPlans = lazy(() => import("./pages/UserSuccessionPlans"));
const CreateSuccessionPlan = lazy(() => import("./pages/CreateSuccessionPlan"));
const ReviewSuccessionPlan = lazy(() => import("./pages/ReviewSuccessionPlan"));
const EditSuccessionNomination = lazy(() => import("./pages/EditSuccessionNomination"));
const MyTeamKpis = lazy(() => import("./pages/MyTeamKpis"));
const CreateTeamKpi = lazy(() => import("./pages/CreateTeamKpi"));
const EditTeamKpi = lazy(() => import("./pages/EditTeamKpi"));
const ViewTeamKpi = lazy(() => import("./pages/ViewTeamKpi"));
const TeamKpis = lazy(() => import("./pages/TeamKpis"));
const Performance = lazy(() => import("./pages/Performance"));
const Career = lazy(() => import("./pages/Career"));
const UserPerformanceReviews = lazy(() => import("./pages/UserPerformanceReviews"));
const CreatePerformanceReview = lazy(() => import("./pages/CreatePerformanceReview"));
const EditPerformanceReview = lazy(() => import("./pages/EditPerformanceReview"));
const ViewPerformanceReview = lazy(() => import("./pages/ViewPerformanceReview"));
const ReviewPeriods = lazy(() => import("./pages/ReviewPeriods"));
const DaysOff = lazy(() => import("./pages/DaysOff"));
const CreateDaysOff = lazy(() => import("./pages/CreateDaysOff"));
const UserDaysOff = lazy(() => import("./pages/UserDaysOff"));
const UserCareer = lazy(() => import("./pages/UserCareer"));
const Pulse = lazy(() => import("./pages/Pulse"));
const PulseCycles = lazy(() => import("./pages/PulseCycles"));
const PublicHolidays = lazy(() => import("./pages/PublicHolidays"));
const DaysOffPoolTypes = lazy(() => import("./pages/DaysOffPoolTypes"));
const Login = lazy(() => import("./pages/Login"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const CreateUser = lazy(() => import("./pages/CreateUser"));
const ImportUsers = lazy(() => import("./pages/ImportUsers"));
const EditUser = lazy(() => import("./pages/EditUser"));
const ChangeUserPassword = lazy(() => import("./pages/ChangeUserPassword"));
const EmailNotifications = lazy(() => import("./pages/EmailNotifications"));
const UserFeatures = lazy(() => import("./pages/UserFeatures"));
const FeatureFlags = lazy(() => import("./pages/FeatureFlags"));
const IntegrationClients = lazy(() => import("./pages/IntegrationClients"));
const UserTeams = lazy(() => import("./pages/UserTeams"));
const UserDetails = lazy(() => import("./pages/UserDetails"));
const CreateTeam = lazy(() => import("./pages/CreateTeam"));
const EditTeam = lazy(() => import("./pages/EditTeam"));
const Teams = lazy(() => import("./pages/Teams"));
const TeamDetails = lazy(() => import("./pages/TeamDetails"));

// The team-details page's historical URLs: /teams/:id/members (renamed v2.5.7 — the page had
// been team details since v2.5.3) and /teams/:id/subordinates (merged in, v2.5.5). Both keep
// working via this redirect (there is no catch-all route); the query string is forwarded so
// back-origin links (?from=myTeams / ?from=org) survive.
function TeamDetailsRedirect() {
  const { teamId } = useParams<{ teamId: string }>();
  const { search } = useLocation();
  return <Navigate to={`/teams/${teamId}/details${search}`} replace />;
}
// Lazy like MarkdownEditor: @xyflow/react + dagre stay out of the main bundle.
const OrgChart = lazy(() => import("./pages/OrgChart"));
const Users = lazy(() => import("./pages/Users"));
const Templates = lazy(() => import("./pages/Templates"));
const CreateTemplate = lazy(() => import("./pages/CreateTemplate"));
const EditTemplate = lazy(() => import("./pages/EditTemplate"));
const ViewTemplate = lazy(() => import("./pages/ViewTemplate"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Dictionary = lazy(() => import("./pages/Dictionary"));
const Changelog = lazy(() => import("./pages/Changelog"));
const CreateAlert = lazy(() => import("./pages/CreateAlert"));
const EditAlert = lazy(() => import("./pages/EditAlert"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback() {
  return <CenteredLoader mih={200} />;
}


/** The header account menu: avatar + name trigger opening email / change-password / logout.
 *  Always rendered (even before — or without — the profile query resolving), so the Logout
 *  affordance never depends on a successful GET /users/{id}. */
function HeaderUserMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const userId = getUserId();
  const { data } = useQuery({
    queryKey: ["currentUser", userId],
    queryFn: getCurrentUser,
    enabled: userId !== null,
    staleTime: 5 * 60 * 1000,
    retry: false
  });
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          px="xs"
          aria-label={t("appShell.userMenu")}
          data-tour="user-menu"
          leftSection={<Avatar name={data?.name} color="initials" size={22} radius="xl" />}
          rightSection={<IconChevronDown size={14} />}
        >
          {data && (
            <Text size="sm" fw={500} truncate maw={160} span>
              {data.name}
            </Text>
          )}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {data && <Menu.Label>{data.email}</Menu.Label>}
        <Menu.Item
          component={RouterLink}
          to={`/users/${userId}/change-password`}
          leftSection={<IconKey size={14} />}
        >
          {t("appShell.nav.changePassword")}
        </Menu.Item>
        <Menu.Item
          component={RouterLink}
          to={`/users/${userId}/email-notifications`}
          leftSection={<IconMail size={14} />}
        >
          {t("appShell.nav.emailNotifications")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconLogout size={14} />} onClick={onLogout}>
          {t("common.action.logout")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function ColorSchemeToggle() {
  const { t } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = computed === "dark" ? "light" : "dark";
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={t("appShell.toggleColorScheme")}
      onClick={() => setColorScheme(next)}
    >
      {computed === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}

function ReplayTourButton() {
  const { t } = useTranslation();
  const { startTour } = useTour();
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={t("tour.replay")}
      data-tour="replay"
      onClick={startTour}
    >
      <IconHelp size={18} />
    </ActionIcon>
  );
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
  const queryClient = useQueryClient();
  const userId = getUserId();
  const { pathname } = useLocation();
  // The grouped navigation (v3.3.0, appShell/navModel.ts): feature/manager/admin gates applied
  // BEFORE the active-leaf lookup, so active-highlight stays coherent.
  const nav = resolveNav({ isAdmin: isAdmin(), isManager, hasFeature }, userId);
  const changelogUnseen = useChangelogUnseen();
  const activeTo = activeLeaf(nav.leafTos, pathname);
  // The icon rail: the desktop toggle narrows the navbar to icons; the mobile overlay keeps
  // full labels (`opened` is only ever true below the sm breakpoint, where the Burger lives).
  const rail = navCollapsed && !opened;

  async function handleLogout() {
    await logout();
    queryClient.clear();
    flagSignedOut();
    navigate("/login", { replace: true });
    notifyAuthChange();
  }

  // While any alerts are visible, the banner strip occupies a permanent row above the header;
  // AppShell propagates the total height into navbar/main offsets automatically.
  const { data: visibleAlerts } = useVisibleAlerts();
  const alertsBarHeight = (visibleAlerts ?? []).length > 0 ? ALERTS_BAR_HEIGHT : 0;

  return (
    // The tour targets navbar items — expanding on start keeps every step's anchor visible.
    <TourProvider onStart={() => setNavCollapsed(false)}>
    <AppShell
      header={{ height: HEADER_HEIGHT + alertsBarHeight }}
      navbar={{
        width: { base: NAV_WIDTH, sm: rail ? RAIL_WIDTH : NAV_WIDTH },
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Header>
        <a href="#main-content" className="skip-link">
          {t("appShell.skipToContent")}
        </a>
        <AlertsBanner />
        <Group h={56} px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
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
            <Text fw={600} size="lg">
              {t("appShell.brand")}
            </Text>
          </Group>
          <Group gap="xs">
            <span data-tour="language" style={{ display: "inline-flex" }}>
              <LanguageSwitcher />
            </span>
            <span data-tour="theme" style={{ display: "inline-flex" }}>
              <ColorSchemeToggle />
            </span>
            <span data-tour="notifications" style={{ display: "inline-flex" }}>
              <NotificationsButton />
            </span>
            <ReplayTourButton />
            <HeaderUserMenu onLogout={handleLogout} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={rail ? "xs" : "sm"}>
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

      <AppShell.Main id="main-content" tabIndex={-1}>
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
    </AppShell>
    </TourProvider>
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
            <Route path="users/:id/email-notifications" element={<EmailNotifications />} />
            <Route path="users/:id/features" element={<UserFeatures />} />
            <Route path="feature-flags" element={<FeatureFlags />} />
            <Route path="integration-clients" element={<IntegrationClients />} />
            <Route path="users/:id/teams" element={<UserTeams />} />
            <Route path="users/:userId/details" element={<UserDetails />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/new" element={<CreateTeam />} />
            <Route path="teams/:id/edit" element={<EditTeam />} />
            <Route path="teams/:id/details" element={<TeamDetails />} />
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
            <Route path="review-periods" element={<ReviewPeriods />} />
            <Route path="pulse" element={<Pulse />} />
            <Route path="pulse-cycles" element={<PulseCycles />} />
            <Route path="days-off" element={<DaysOff />} />
            <Route path="days-off/new" element={<CreateDaysOff />} />
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
