import { lazy, Suspense, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  NavLink,
  Text,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCalendarEvent,
  IconFileText,
  IconHelp,
  IconHierarchy,
  IconHistory,
  IconSpeakerphone,
  IconKey,
  IconLayoutDashboard,
  IconMessageCircle,
  IconMoon,
  IconSettings,
  IconSun,
  IconTargetArrow,
  IconUserCircle,
  IconUserScan,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  Link as RouterLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getCurrentUser, getUserId, isAdmin, logout } from "./api/client";
import { RedirectIfAuthed, RequireAuth, flagSignedOut, notifyAuthChange } from "./auth";
import AlertsBanner from "./components/AlertsBanner";
import { ALERTS_BAR_HEIGHT, useVisibleAlerts } from "./hooks/useVisibleAlerts";
import BrandLogo from "./components/BrandLogo";
import NotificationsButton from "./components/NotificationsButton";
import LanguageSwitcher from "./components/LanguageSwitcher";
import VersionStamp from "./components/VersionStamp";
import { useChangelogUnseen } from "./hooks/useChangelogSeen";
import { TourProvider } from "./components/Tour";
import { useTour } from "./components/tourSupport";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Feedback = lazy(() => import("./pages/Feedback"));
const CreateFeedback = lazy(() => import("./pages/CreateFeedback"));
const RequestFeedback = lazy(() => import("./pages/RequestFeedback"));
const AskFeedback = lazy(() => import("./pages/AskFeedback"));
const SelfReflection = lazy(() => import("./pages/SelfReflection"));
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
const Login = lazy(() => import("./pages/Login"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const CreateUser = lazy(() => import("./pages/CreateUser"));
const ImportUsers = lazy(() => import("./pages/ImportUsers"));
const EditUser = lazy(() => import("./pages/EditUser"));
const ChangeUserPassword = lazy(() => import("./pages/ChangeUserPassword"));
const UserTeams = lazy(() => import("./pages/UserTeams"));
const UserDetails = lazy(() => import("./pages/UserDetails"));
const CreateTeam = lazy(() => import("./pages/CreateTeam"));
const EditTeam = lazy(() => import("./pages/EditTeam"));
const Teams = lazy(() => import("./pages/Teams"));
const TeamMembers = lazy(() => import("./pages/TeamMembers"));
const TeamSubordinates = lazy(() => import("./pages/TeamSubordinates"));
// Lazy like MarkdownEditor: @xyflow/react + dagre stay out of the main bundle.
const OrgChart = lazy(() => import("./pages/OrgChart"));
const Users = lazy(() => import("./pages/Users"));
const Templates = lazy(() => import("./pages/Templates"));
const CreateTemplate = lazy(() => import("./pages/CreateTemplate"));
const EditTemplate = lazy(() => import("./pages/EditTemplate"));
const ViewTemplate = lazy(() => import("./pages/ViewTemplate"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Changelog = lazy(() => import("./pages/Changelog"));
const CreateAlert = lazy(() => import("./pages/CreateAlert"));
const EditAlert = lazy(() => import("./pages/EditAlert"));

function RouteFallback() {
  return (
    <Center mih={200}>
      <Loader />
    </Center>
  );
}

type NavLeaf = { to: string; label: string; icon: typeof IconLayoutDashboard; tourId?: string };
type NavGroup = { label: string; icon: typeof IconLayoutDashboard; children: NavLeaf[]; tourId?: string };
type NavEntry = NavLeaf | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

// `label` holds an i18n key, resolved with t() at render time. `tourId` (when set) becomes a
// `data-tour` attribute the guided tour anchors to.
const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  { to: "/", label: "appShell.nav.dashboard", icon: IconLayoutDashboard, tourId: "nav-dashboard" },
  { to: "/feedback", label: "appShell.nav.feedback", icon: IconMessageCircle, tourId: "nav-feedback" },
  { to: "/one-on-ones", label: "appShell.nav.oneOnOnes", icon: IconCalendarEvent, tourId: "nav-one-on-ones" },
  { to: "/goals", label: "appShell.nav.goals", icon: IconTargetArrow, tourId: "nav-my-goals" },
  {
    label: "appShell.nav.config",
    icon: IconSettings,
    tourId: "nav-config",
    children: [
      { to: "/users", label: "appShell.nav.users", icon: IconUsers },
      { to: "/teams", label: "appShell.nav.teams", icon: IconUsersGroup },
      { to: "/org", label: "appShell.nav.orgChart", icon: IconHierarchy },
      { to: "/templates", label: "appShell.nav.templates", icon: IconFileText },
    ],
  },
];

// Rendered last, directly above the version stamp it pairs with (after the per-user dynamic
// items), rather than inside NAV_ITEMS.
const CHANGELOG_NAV: NavLeaf = { to: "/changelog", label: "appShell.nav.changelog", icon: IconHistory, tourId: "nav-changelog" };

function HeaderUser() {
  const userId = getUserId();
  const { data } = useQuery({
    queryKey: ["currentUser", userId],
    queryFn: getCurrentUser,
    enabled: userId !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!data) return null;
  return (
    <Group gap="xs" wrap="nowrap">
      <IconUserCircle size={18} stroke={1.5} />
      <Text size="sm" fw={500} truncate maw={160}>
        {data.name}
      </Text>
    </Group>
  );
}

function ColorSchemeToggle() {
  const { t } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = computed === "dark" ? "light" : "dark";
  return (
    <ActionIcon
      variant="default"
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
      variant="default"
      size="lg"
      aria-label={t("tour.replay")}
      data-tour="replay"
      onClick={startTour}
    >
      <IconHelp size={18} />
    </ActionIcon>
  );
}

/** A collapsible navbar group. Controlled so it auto-expands when one of its child routes becomes
 *  active (e.g. programmatic navigation from the guided tour), while staying manually toggleable. */
function NavGroupLink({
  entry,
  activeTo,
  onNavigate,
}: {
  entry: NavGroup;
  activeTo: string | null;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const childActive = entry.children.some((c) => c.to === activeTo);
  const [opened, setOpened] = useState(childActive);
  // Auto-expand when a child route becomes active, while staying manually collapsible afterwards.
  // Adjust-state-during-render (the React-docs alternative to a setState-in-effect): the change
  // check keeps it a one-shot on the transition, and React re-renders before committing.
  const [wasChildActive, setWasChildActive] = useState(childActive);
  if (childActive !== wasChildActive) {
    setWasChildActive(childActive);
    if (childActive) setOpened(true);
  }
  const GroupIcon = entry.icon;
  return (
    // component="button": the default polymorphic root is an <a> without href,
    // which is not keyboard-focusable — the group would be unreachable by Tab.
    <NavLink
      component="button"
      label={t(entry.label)}
      leftSection={<GroupIcon size={18} stroke={1.5} />}
      opened={opened}
      onChange={setOpened}
      childrenOffset={28}
      data-tour={entry.tourId}
    >
      {entry.children.map(({ to, label, icon: Icon }) => {
        const active = to === activeTo;
        return (
          <NavLink
            key={to}
            component={RouterLink}
            to={to}
            active={active}
            aria-current={active ? "page" : undefined}
            label={t(label)}
            leftSection={<Icon size={18} stroke={1.5} />}
            onClick={onNavigate}
          />
        );
      })}
    </NavLink>
  );
}

function Shell() {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = getUserId();
  const { pathname } = useLocation();
  const dynamicItems: NavLeaf[] =
    userId !== null
      ? [
          { to: "/feedback/self", label: "appShell.nav.selfReflection", icon: IconUserScan, tourId: "nav-self-reflection" },
          { to: `/users/${userId}/change-password`, label: "appShell.nav.changePassword", icon: IconKey, tourId: "nav-change-password" },
        ]
      : [];
  // Alert management is ADMIN-only end to end, so non-admins don't get the menu entry.
  const staticItems: NavEntry[] = NAV_ITEMS.map((e) =>
    isGroup(e) && e.label === "appShell.nav.config" && isAdmin()
      ? {
          ...e,
          children: [
            ...e.children,
            { to: "/alerts", label: "appShell.nav.alerts", icon: IconSpeakerphone },
          ],
        }
      : e,
  );
  const allEntries: NavEntry[] = [...staticItems, ...dynamicItems, CHANGELOG_NAV];
  const changelogUnseen = useChangelogUnseen();
  const leafTos = allEntries.flatMap((e) =>
    isGroup(e) ? e.children.map((c) => c.to) : [e.to],
  );
  const matches = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  const activeTo =
    leafTos.filter(matches).sort((a, b) => b.length - a.length)[0] ?? null;

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
    <TourProvider>
    <AppShell
      header={{ height: 56 + alertsBarHeight }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
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
            <BrandLogo />
            <Text fw={600} size="lg">
              {t("appShell.brand")}
            </Text>
          </Group>
          <Group gap="sm">
            <HeaderUser />
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
            <Button variant="default" size="sm" onClick={handleLogout} data-tour="logout">
              {t("common.action.logout")}
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {allEntries.map((entry) => {
          if (!isGroup(entry)) {
            const active = entry.to === activeTo;
            const Icon = entry.icon;
            return (
              <NavLink
                key={entry.to}
                component={RouterLink}
                to={entry.to}
                active={active}
                aria-current={active ? "page" : undefined}
                label={t(entry.label)}
                leftSection={<Icon size={18} stroke={1.5} />}
                data-tour={entry.tourId}
                onClick={close}
              />
            );
          }
          return (
            <NavGroupLink
              key={entry.label}
              entry={entry}
              activeTo={activeTo}
              onNavigate={close}
            />
          );
        })}
        {/* The title carries the accessible "what's new" name only while the dot is shown. */}
        <Indicator
          color="red"
          size={8}
          disabled={!changelogUnseen}
          title={changelogUnseen ? t("changelog.whatsNew") : undefined}
          mt="auto"
        >
          <VersionStamp to="/changelog" ta="center" pt="xs" />
        </Indicator>
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
    </TourProvider>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
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
            <Route path="users/:id/teams" element={<UserTeams />} />
            <Route path="users/:userId/details" element={<UserDetails />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/new" element={<CreateTeam />} />
            <Route path="teams/:id/edit" element={<EditTeam />} />
            <Route path="teams/:id/members" element={<TeamMembers />} />
            <Route path="teams/:teamId/subordinates" element={<TeamSubordinates />} />
            <Route path="org" element={<OrgChart />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="feedback/new" element={<CreateFeedback />} />
            <Route path="feedback/request" element={<RequestFeedback />} />
            <Route path="feedback/ask" element={<AskFeedback />} />
            <Route path="feedback/self" element={<SelfReflection />} />
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
            <Route path="templates" element={<Templates />} />
            <Route path="templates/new" element={<CreateTemplate />} />
            <Route path="templates/:id/edit" element={<EditTemplate />} />
            <Route path="templates/:id/view" element={<ViewTemplate />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="alerts/new" element={<CreateAlert />} />
            <Route path="alerts/:id/edit" element={<EditAlert />} />
            <Route path="changelog" element={<Changelog />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
