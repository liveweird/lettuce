import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  NavLink,
  Text,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
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
import Dashboard from "./pages/Dashboard";
import Feedback from "./pages/Feedback";
import Login from "./pages/Login";
import CreateUser from "./pages/CreateUser";
import Teams from "./pages/Teams";
import Users from "./pages/Users";

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
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export default function App() {
  return (
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
          <Route path="teams" element={<Teams />} />
          <Route path="feedback" element={<Feedback />} />
        </Route>
      </Route>
    </Routes>
  );
}
