import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Avatar,
  Badge,
  Box,
  Group,
  Indicator,
  Menu,
  Skeleton,
  Text,
  UnstyledButton,
  useMantineColorScheme,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconActivity,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconHelp,
  IconHistory,
  IconKey,
  IconLogout,
} from "@tabler/icons-react";
import { getRoles, getUserId, isAdmin } from "../api/session";
import { getCurrentUser, setUserLanguage } from "../api/users";
import { asSupportedLanguage, NATIVE_LANGUAGE_NAMES, switchLanguage, SUPPORTED_LANGUAGES } from "../i18n";
import { useChangelogUnseen } from "../hooks/useChangelogSeen";
import { useMenuTabExit } from "../hooks/useMenuTabExit";
import { toggleTelemetryPanel, useTelemetryPanelOpen } from "../hooks/useTelemetryPanel";
import DestructiveMenuItem from "./DestructiveMenuItem";
import TutorialsSubmenu from "./TutorialsSubmenu";
import { useTour } from "./tourSupport";

const THEMES = [
  { value: "light", label: "appShell.account.themeLight" },
  { value: "dark", label: "appShell.account.themeDark" },
  { value: "auto", label: "appShell.account.themeAuto" },
] as const;

/** Width of the name skeleton while the profile loads (px). The name then sizes to its content (at most 160): the late-arriving name moves the
 *  header's right group by the difference. Accepted in v4.22.0 - the trigger no longer reserves a fixed slot (v4.15.2 did, at 160 px). */
const NAME_SKELETON_WIDTH = 96;

/**
 * The header account menu (v4.22.0): the signed-in user's identity (name, email, roles), then every account-scoped control - the
 * language, the colour scheme, Change password, Notification preferences, the tutorials, Replay the tour, the Changelog (with the
 * what's-new marker), the ADMIN telemetry toggle - and Logout. Always rendered (even before - or without - the profile query
 * resolving), so Logout never depends on a successful GET /users/{id}.
 *
 * Language: the languages' NATIVE names (readable before switching); a pick switches the UI and fire-and-forgets the SERVER-side
 * user language (one synced language - it drives the UI at sign-in and every email sent to the user). Theme: the three real states
 * (light / dark / system - the provider mounts `defaultColorScheme="auto"`) as items with `closeMenuOnClick={false}`, so the menu stays
 * open (not a SegmentedControl: a radiogroup is not allowed inside `role="menu"`, axe `aria-required-children`). Mantine fixes an
 * item's role to "menuitem", so the chosen language/theme (and the telemetry toggle's on state) is carried by the global aria-current.
 *
 * The what's-new dot rides the TRIGGER, decoratively: it carries no `title`, because the navbar's version stamp already owns the
 * accessible "What's new" name (two titled nodes trip strict-mode locators); the Changelog item inside the menu says "New" in text.
 */
export default function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { startTour } = useTour();
  const changelogUnseen = useChangelogUnseen();
  const telemetryOpen = useTelemetryPanelOpen();
  const tabExit = useMenuTabExit();
  const userId = getUserId();
  const admin = isAdmin();
  const roles = getRoles();
  const current = asSupportedLanguage(i18n.resolvedLanguage);
  const { data, isLoading } = useQuery({
    queryKey: ["currentUser", userId],
    queryFn: getCurrentUser,
    enabled: userId !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  function pickLanguage(lng: string) {
    switchLanguage(asSupportedLanguage(lng)).catch((e) => console.error("Language switch failed", e));
    if (userId !== null) {
      setUserLanguage(userId, lng).catch((e) => console.error("Language sync failed", e));
    }
  }

  return (
    <Menu position="bottom-end" width={260} withinPortal {...tabExit.menu}>
      {/* The Indicator wraps the TARGET, not the other way round: Menu.Target clones its child with aria-expanded / aria-controls,
          which are only allowed on the button. */}
      <Indicator color="red" size={8} offset={4} disabled={!changelogUnseen}>
        <Menu.Target>
          {/* No aria-label: the name is the visible name plus a visually hidden "User menu" (WCAG 2.5.3 Label in Name - a label that
              replaces the visible words fails axe's label-content-name-mismatch). The avatar is decoration for the name beside it. */}
          <UnstyledButton px={4} py={2} data-tour="user-menu">
            <Group gap={6} wrap="nowrap">
              <Avatar name={data?.name} color="initials" size={28} radius="xl" aria-hidden />
              {isLoading ? (
                <Skeleton h={12} w={NAME_SKELETON_WIDTH} radius="xl" visibleFrom="sm" />
              ) : (
                data && (
                  <Text size="sm" fw={500} visibleFrom="sm" truncate maw={160}>
                    {data.name}
                  </Text>
                )
              )}
              <IconChevronDown size={14} />
              <VisuallyHidden>{t("appShell.userMenu")}</VisuallyHidden>
            </Group>
          </UnstyledButton>
        </Menu.Target>
      </Indicator>
      <Menu.Dropdown {...tabExit.dropdown}>
        {data && (
          <>
            <Box px="sm" py="xs">
              <Text size="sm" fw={600} truncate>
                {data.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {data.email}
              </Text>
              {roles.length > 0 && (
                <Group gap={4} mt={4}>
                  {roles.map((role) => (
                    <Badge key={role} size="xs" variant="outline" color="gray">
                      {t(`common.role.${role}`)}
                    </Badge>
                  ))}
                </Group>
              )}
            </Box>
            <Menu.Divider />
          </>
        )}
        <Menu.Label>{t("common.language.label")}</Menu.Label>
        {SUPPORTED_LANGUAGES.map((lng) => (
          <Menu.Item
            key={lng}
            onClick={() => pickLanguage(lng)}
            aria-current={lng === current ? "true" : undefined}
            leftSection={lng === current ? <IconCheck size={14} /> : <Box w={14} />}
          >
            {NATIVE_LANGUAGE_NAMES[lng]}
          </Menu.Item>
        ))}
        <Menu.Label>{t("appShell.account.theme")}</Menu.Label>
        {THEMES.map(({ value, label }) => (
          <Menu.Item
            key={value}
            closeMenuOnClick={false}
            onClick={() => setColorScheme(value)}
            aria-current={value === colorScheme ? "true" : undefined}
            leftSection={value === colorScheme ? <IconCheck size={14} /> : <Box w={14} />}
          >
            {t(label)}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item component={RouterLink} to={`/users/${userId}/change-password`} leftSection={<IconKey size={14} />}>
          {t("appShell.nav.changePassword")}
        </Menu.Item>
        <Menu.Item
          component={RouterLink}
          to={`/users/${userId}/notification-preferences`}
          leftSection={<IconBell size={14} />}
        >
          {t("appShell.nav.notificationPreferences")}
        </Menu.Item>
        <TutorialsSubmenu />
        <Menu.Item leftSection={<IconHelp size={14} />} onClick={startTour}>
          {t("tour.replay")}
        </Menu.Item>
        <Menu.Item
          component={RouterLink}
          to="/changelog"
          leftSection={<IconHistory size={14} />}
          rightSection={
            changelogUnseen ? (
              <Badge size="xs" color="red" variant="filled">
                {t("changelog.newBadge")}
              </Badge>
            ) : undefined
          }
        >
          {t("appShell.nav.changelog")}
        </Menu.Item>
        {admin && (
          // ADMIN-only tooling, not a feature or a nav leaf (v4.20.0): a toggle for the shell's telemetry aside; the check mark (and
          // aria-current) says it is on.
          <Menu.Item
            leftSection={<IconActivity size={14} />}
            rightSection={telemetryOpen ? <IconCheck size={14} /> : undefined}
            aria-current={telemetryOpen ? "true" : undefined}
            onClick={toggleTelemetryPanel}
          >
            {t("telemetry.menuItem")}
          </Menu.Item>
        )}
        <Menu.Divider />
        <DestructiveMenuItem leftSection={<IconLogout size={14} />} onClick={onLogout}>
          {t("common.action.logout")}
        </DestructiveMenuItem>
      </Menu.Dropdown>
    </Menu>
  );
}
