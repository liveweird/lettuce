import { lazy, Suspense } from "react";
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
import { getCurrentUser, getUserId, logout } from "./api/client";
import { RedirectIfAuthed, RequireAuth, flagSignedOut, notifyAuthChange } from "./auth";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Feedback = lazy(() => import("./pages/Feedback"));
const CreateFeedback = lazy(() => import("./pages/CreateFeedback"));
const RequestFeedback = lazy(() => import("./pages/RequestFeedback"));
const EditFeedback = lazy(() => import("./pages/EditFeedback"));
const ViewFeedback = lazy(() => import("./pages/ViewFeedback"));
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

type NavLeaf = { to: string; label: string; icon: typeof IconLayoutDashboard };
type NavGroup = { label: string; icon: typeof IconLayoutDashboard; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/feedback", label: "Feedback", icon: IconMessageCircle },
  {
    label: "Config",
    icon: IconSettings,
    children: [
      { to: "/users", label: "Users", icon: IconUsers },
      { to: "/teams", label: "Teams", icon: IconUsersGroup },
      { to: "/templates", label: "Templates", icon: IconFileText },
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
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = computed === "dark" ? "light" : "dark";
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label="Toggle color scheme"
      onClick={() => setColorScheme(next)}
    >
      {computed === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}

function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = getUserId();
  const { pathname } = useLocation();
  const dynamicItems: NavLeaf[] =
    userId !== null
      ? [{ to: `/users/${userId}/change-password`, label: "Change password", icon: IconKey }]
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
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={600} size="lg">
              Lettuce
            </Text>
          </Group>
          <Group gap="sm">
            <HeaderUser />
            <ColorSchemeToggle />
            <Button variant="default" size="sm" onClick={handleLogout}>
              Logout
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
                label={entry.label}
                leftSection={<Icon size={18} stroke={1.5} />}
                onClick={close}
              />
            );
          }
          const GroupIcon = entry.icon;
          const childActive = entry.children.some((c) => c.to === activeTo);
          return (
            <NavLink
              key={entry.label}
              label={entry.label}
              leftSection={<GroupIcon size={18} stroke={1.5} />}
              defaultOpened={childActive}
              childrenOffset={28}
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
                    label={label}
                    leftSection={<Icon size={18} stroke={1.5} />}
                    onClick={close}
                  />
                );
              })}
            </NavLink>
          );
        })}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
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
            <Route path="feedback/:id/edit" element={<EditFeedback />} />
            <Route path="feedback/:id/view" element={<ViewFeedback />} />
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
