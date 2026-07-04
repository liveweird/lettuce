import { lazy, Suspense, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Center,
  Group,
  Loader,
  NavLink,
  Text,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconFileText,
  IconHelp,
  IconKey,
  IconLayoutDashboard,
  IconMessageCircle,
  IconMoon,
  IconSettings,
  IconSun,
  IconUserCircle,
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
import { getCurrentUser, getUserId, logout } from "./api/client";
import { RedirectIfAuthed, RequireAuth, flagSignedOut, notifyAuthChange } from "./auth";
import BrandLogo from "./components/BrandLogo";
import NotificationsButton from "./components/NotificationsButton";
import LanguageSwitcher from "./components/LanguageSwitcher";
import VersionStamp from "./components/VersionStamp";
import { TourProvider } from "./components/Tour";
import { useTour } from "./components/tourSupport";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Feedback = lazy(() => import("./pages/Feedback"));
const CreateFeedback = lazy(() => import("./pages/CreateFeedback"));
const RequestFeedback = lazy(() => import("./pages/RequestFeedback"));
const AskFeedback = lazy(() => import("./pages/AskFeedback"));
const EditFeedback = lazy(() => import("./pages/EditFeedback"));
const ViewFeedback = lazy(() => import("./pages/ViewFeedback"));
const ManagerFeedbacks = lazy(() => import("./pages/ManagerFeedbacks"));
const Login = lazy(() => import("./pages/Login"));
const CreateUser = lazy(() => import("./pages/CreateUser"));
const EditUser = lazy(() => import("./pages/EditUser"));
const ChangeUserPassword = lazy(() => import("./pages/ChangeUserPassword"));
const UserTeams = lazy(() => import("./pages/UserTeams"));
const CreateTeam = lazy(() => import("./pages/CreateTeam"));
const EditTeam = lazy(() => import("./pages/EditTeam"));
const Teams = lazy(() => import("./pages/Teams"));
const TeamMembers = lazy(() => import("./pages/TeamMembers"));
const Users = lazy(() => import("./pages/Users"));
const Templates = lazy(() => import("./pages/Templates"));
const CreateTemplate = lazy(() => import("./pages/CreateTemplate"));
const EditTemplate = lazy(() => import("./pages/EditTemplate"));
const ViewTemplate = lazy(() => import("./pages/ViewTemplate"));

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
  {
    label: "appShell.nav.config",
    icon: IconSettings,
    tourId: "nav-config",
    children: [
      { to: "/users", label: "appShell.nav.users", icon: IconUsers },
      { to: "/teams", label: "appShell.nav.teams", icon: IconUsersGroup },
      { to: "/templates", label: "appShell.nav.templates", icon: IconFileText },
    ],
  },
];

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
      ? [{ to: `/users/${userId}/change-password`, label: "appShell.nav.changePassword", icon: IconKey, tourId: "nav-change-password" }]
      : [];
  const allEntries: NavEntry[] = [...NAV_ITEMS, ...dynamicItems];
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

  return (
    <TourProvider>
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <a href="#main-content" className="skip-link">
          {t("appShell.skipToContent")}
        </a>
        <Group h="100%" px="md" justify="space-between">
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
        <VersionStamp mt="auto" ta="center" pt="xs" />
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
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="users/new" element={<CreateUser />} />
            <Route path="users/:id/edit" element={<EditUser />} />
            <Route path="users/:id/change-password" element={<ChangeUserPassword />} />
            <Route path="users/:id/teams" element={<UserTeams />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/new" element={<CreateTeam />} />
            <Route path="teams/:id/edit" element={<EditTeam />} />
            <Route path="teams/:id/members" element={<TeamMembers />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="feedback/new" element={<CreateFeedback />} />
            <Route path="feedback/request" element={<RequestFeedback />} />
            <Route path="feedback/ask" element={<AskFeedback />} />
            <Route path="feedback/:id/edit" element={<EditFeedback />} />
            <Route path="feedback/:id/view" element={<ViewFeedback />} />
            <Route path="users/:userId/feedbacks" element={<ManagerFeedbacks />} />
            <Route path="templates" element={<Templates />} />
            <Route path="templates/new" element={<CreateTemplate />} />
            <Route path="templates/:id/edit" element={<EditTemplate />} />
            <Route path="templates/:id/view" element={<ViewTemplate />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
