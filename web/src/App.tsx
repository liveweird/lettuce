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
import { logout } from "./api/client";
import { notifyAuthChange, useAuth } from "./auth";
import Dashboard from "./pages/Dashboard";
import Feedback from "./pages/Feedback";
import Login from "./pages/Login";
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
  const { isAuthenticated } = useAuth();

  async function handleLogout() {
    await logout();
    notifyAuthChange();
    navigate("/login");
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
            <ColorSchemeToggle />
            {isAuthenticated && (
              <Button variant="default" size="sm" onClick={handleLogout}>
                Logout
              </Button>
            )}
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
      <Route path="/login" element={<Login />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="teams" element={<Teams />} />
        <Route path="feedback" element={<Feedback />} />
      </Route>
    </Routes>
  );
}
