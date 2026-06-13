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
  IconKey,
  IconLayoutDashboard,
  IconMessageCircle,
  IconMoon,
  IconSun,
  IconUserCircle,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  NavLink as RouterNavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getUserId, logout } from "./api/client";
import { RedirectIfAuthed, RequireAuth, flagSignedOut, notifyAuthChange } from "./auth";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Login = lazy(() => import("./pages/Login"));
const CreateUser = lazy(() => import("./pages/CreateUser"));
const EditUser = lazy(() => import("./pages/EditUser"));
const ChangeUserPassword = lazy(() => import("./pages/ChangeUserPassword"));
const CreateTeam = lazy(() => import("./pages/CreateTeam"));
const EditTeam = lazy(() => import("./pages/EditTeam"));
const Teams = lazy(() => import("./pages/Teams"));
const Users = lazy(() => import("./pages/Users"));

function RouteFallback() {
  return (
    <Center mih={200}>
      <Loader />
    </Center>
  );
}

const NAV_ITEMS: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof IconLayoutDashboard;
}> = [
  { to: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/users", label: "Users", icon: IconUsers },
  { to: "/teams", label: "Teams", icon: IconUsersGroup },
  { to: "/feedback", label: "Feedback", icon: IconMessageCircle },
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
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            component={RouterNavLink}
            to={to}
            end={to === "/"}
            label={label}
            leftSection={<Icon size={18} stroke={1.5} />}
            onClick={close}
          />
        ))}
        {userId !== null && (
          <NavLink
            component={RouterNavLink}
            to={`/users/${userId}/change-password`}
            label="Change password"
            leftSection={<IconKey size={18} stroke={1.5} />}
            onClick={close}
          />
        )}
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
            <Route path="teams" element={<Teams />} />
            <Route path="teams/new" element={<CreateTeam />} />
            <Route path="teams/:id/edit" element={<EditTeam />} />
            <Route path="feedback" element={<Feedback />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
