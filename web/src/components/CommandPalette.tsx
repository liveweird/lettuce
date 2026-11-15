import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ActionIcon, Kbd, Text, UnstyledButton } from "@mantine/core";
import { useOs } from "@mantine/hooks";
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData, type SpotlightFilterFunction } from "@mantine/spotlight";
import { IconActivity, IconBell, IconSearch } from "@tabler/icons-react";
import { getUserId, isAdmin } from "../api/session";
import { isGroup, type NavLeaf, type ResolvedNav } from "../appShell/navModel";
import { setTelemetryPanelOpen, useTelemetryPanelOpen } from "../hooks/useTelemetryPanel";
import { palette, paletteStore } from "../utils/commandPalette";
import { foldDiacritics } from "../utils/text";
import classes from "../theme.module.css";

/**
 * The command palette (v4.22.0): ⌘K / Ctrl K, or the search-looking trigger in the header. One "Pages" group - every
 * destination the sidebar offers THIS caller (the Shell passes the already-resolved nav, so the feature / manager / admin
 * gates are the nav's own), plus the account-menu destination the nav does not carry (notification preferences) - and, for an
 * ADMIN, an "Actions" group. Matching is client-side on the diacritic-folded label ("zolw" finds "Żółw"). A group's leaf reads
 * "Group › Leaf" so the dictionaries' bare names stay unambiguous. Renders BOTH the trigger and the Spotlight, mounted once in
 * the shell header. No `highlightQuery`: it splits a label into `<mark>` + text fragments, and tests/e2e locate results by their
 * full name.
 */
export default function CommandPalette({ nav }: { nav: ResolvedNav }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const os = useOs();
  const [query, setQuery] = useState("");
  const telemetryOpen = useTelemetryPanelOpen();
  const admin = isAdmin();
  const userId = getUserId();

  // The store is module-level: close it when the shell unmounts (sign-out, a session replaced in another tab), or the next
  // session's shell would mount with the palette already open.
  useEffect(() => () => palette.close(), []);

  const go = (to: string) => {
    palette.close();
    navigate(to);
  };
  const pageAction = (leaf: NavLeaf, label: string): SpotlightActionData => ({
    id: `page:${leaf.to}`,
    label,
    leftSection: <leaf.icon size={18} stroke={1.5} />,
    onClick: () => go(leaf.to),
  });

  const leaves: SpotlightActionData[] = [
    ...nav.sections.flatMap((section) =>
      section.entries.flatMap((entry) =>
        isGroup(entry)
          ? entry.children.map((child) => pageAction(child, `${t(entry.label)} › ${t(child.label)}`))
          : [pageAction(entry, t(entry.label))],
      ),
    ),
    ...nav.footer.map((leaf) => pageAction(leaf, t(leaf.label))),
    // The account menu's own destination (the nav carries Change password and the Changelog itself).
    ...(userId === null
      ? []
      : [
          pageAction(
            { to: `/users/${userId}/notification-preferences`, label: "appShell.nav.notificationPreferences", icon: IconBell },
            t("appShell.nav.notificationPreferences"),
          ),
        ]),
  ];
  const pages: SpotlightActionGroupData = {
    group: t("appShell.palette.groupPages"),
    actions: leaves.filter((action, index) => leaves.findIndex((other) => other.id === action.id) === index),
  };
  // Actions: the ADMIN-only toggle of the telemetry panel (the same flag as the account menu's item).
  const actions: SpotlightActionGroupData = {
    group: t("appShell.palette.groupActions"),
    actions: [
      {
        id: "action:telemetry-panel",
        label: t(telemetryOpen ? "appShell.palette.telemetryHide" : "appShell.palette.telemetryShow"),
        leftSection: <IconActivity size={18} stroke={1.5} />,
        onClick: () => {
          palette.close();
          setTelemetryPanelOpen(!telemetryOpen);
        },
      },
    ],
  };
  const filter: SpotlightFilterFunction = (q, entries) => {
    const folded = foldDiacritics(q.trim());
    return entries.flatMap((entry): (SpotlightActionData | SpotlightActionGroupData)[] => {
      if (!("actions" in entry)) return [entry];
      const items = entry.actions.filter((a) => foldDiacritics(String(a.label ?? "")).includes(folded));
      return items.length > 0 ? [{ ...entry, actions: items }] : [];
    });
  };
  const shortcut = os === "macos" ? "⌘ K" : "Ctrl K";
  return (
    // The tour's anchor: a wrapper that exists at every width (the wide trigger and the icon-only one swap at `sm`).
    <span data-tour="search" style={{ display: "inline-flex" }}>
      {/* No aria-label on the wide trigger: its name is its visible words (WCAG 2.5.3 Label in Name); only the icon-only one needs a label. */}
      <UnstyledButton className={classes.paletteTrigger} visibleFrom="sm" onClick={palette.open}>
        <IconSearch size={16} />
        <Text component="span" size="sm" inherit>
          {t("appShell.palette.placeholder")}
        </Text>
        <Kbd size="xs">{shortcut}</Kbd>
      </UnstyledButton>
      <ActionIcon variant="subtle" color="gray" hiddenFrom="sm" size="lg" aria-label={t("appShell.palette.open")} onClick={palette.open}>
        <IconSearch size={18} />
      </ActionIcon>
      <Spotlight
        store={paletteStore}
        shortcut="mod + K"
        query={query}
        onQueryChange={setQuery}
        actions={admin ? [pages, actions] : [pages]}
        filter={filter}
        nothingFound={t("appShell.palette.nothingFound")}
        scrollable
        maxHeight={420}
        searchProps={{
          leftSection: <IconSearch size={18} stroke={1.5} />,
          placeholder: t("appShell.palette.placeholder"),
          "aria-label": t("appShell.palette.placeholder"),
        }}
      />
    </span>
  );
}
