import { useCallback, useEffect, useRef, useState, type TransitionEvent } from "react";
import { AppShell, Divider, Indicator, Menu, NavLink, Stack, Text, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import VersionStamp from "../components/VersionStamp";
import { isGroup, type NavGroup, type NavLeaf, type NavSection } from "./navModel";
import classes from "./AppNav.module.css";

type SetActiveTarget = (node: HTMLElement | null) => void;

type LeafProps = {
  leaf: NavLeaf;
  active: boolean;
  rail: boolean;
  quiet?: boolean;
  onNavigate: () => void;
  setActiveTarget?: SetActiveTarget;
};

function NavLeafLink({ leaf, active, rail, quiet = false, onNavigate, setActiveTarget }: LeafProps) {
  const { t } = useTranslation();
  const Icon = leaf.icon;
  const label = t(leaf.label);
  if (rail) {
    // Icon-only: the accessible NAME stays the label (aria-label), so every locator that
    // finds the link by name works in both modes.
    return (
      <Tooltip label={label} position="right" withinPortal>
        <NavLink
          component={RouterLink}
          to={leaf.to}
          active={active}
          aria-current={active ? "page" : undefined}
          aria-label={label}
          leftSection={<Icon size={20} stroke={1.5} />}
          data-tour={leaf.tourId}
          className={classes.railLink}
          onClick={onNavigate}
          ref={active ? setActiveTarget : undefined}
        />
      </Tooltip>
    );
  }
  return (
    <NavLink
      component={RouterLink}
      to={leaf.to}
      active={active}
      aria-current={active ? "page" : undefined}
      label={label}
      leftSection={<Icon size={18} stroke={1.5} />}
      data-tour={leaf.tourId}
      className={quiet ? classes.quietLink : undefined}
      onClick={onNavigate}
      ref={active ? setActiveTarget : undefined}
    />
  );
}

/** A collapsible navbar group. Controlled so it auto-expands when one of its child routes becomes
 *  active (e.g. programmatic navigation from the guided tour), while staying manually toggleable. */
function NavGroupLink({
  entry,
  activeTo,
  onNavigate,
  setActiveTarget,
  revealActive,
}: {
  entry: NavGroup;
  activeTo: string | null;
  onNavigate: () => void;
  setActiveTarget: SetActiveTarget;
  revealActive: () => void;
}) {
  const { t } = useTranslation();
  const childActive = entry.children.some((c) => c.to === activeTo);
  const [opened, setOpened] = useState(childActive);
  // Auto-expand when a child route becomes active, while staying manually collapsible afterwards.
  // Adjust-state-during-render (the React-docs alternative to a setState-in-effect): the change
  // check keeps it a one-shot on the transition, and React re-renders before committing.
  const [previousActiveTo, setPreviousActiveTo] = useState(activeTo);
  if (activeTo !== previousActiveTo) {
    setPreviousActiveTo(activeTo);
    if (childActive) setOpened(true);
  }
  // Reduced-motion Collapse mounts directly and emits no transitionend. The commit effect
  // also handles manual reopening; animated expansion gets a final check below.
  useEffect(() => {
    if (opened && childActive) revealActive();
  }, [opened, childActive, activeTo, revealActive]);
  const GroupIcon = entry.icon;
  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    // Mantine expands nested links by animating the collapse element's height. Re-check once
    // it reaches its final geometry; the route effect can run while the leaf is still clipped.
    if (opened && childActive && event.propertyName === "height") revealActive();
  }
  return (
    <div onTransitionEnd={handleTransitionEnd}>
      {/* component="button": the default polymorphic root is an <a> without href,
          which is not keyboard-focusable — the group would be unreachable by Tab. */}
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
              ref={active ? setActiveTarget : undefined}
            />
          );
        })}
      </NavLink>
    </div>
  );
}

/** The rail form of a group: an icon button opening a right-anchored menu of its leaves. */
function NavGroupMenu({
  entry,
  activeTo,
  onNavigate,
  setActiveTarget,
}: {
  entry: NavGroup;
  activeTo: string | null;
  onNavigate: () => void;
  setActiveTarget: SetActiveTarget;
}) {
  const { t } = useTranslation();
  const label = t(entry.label);
  const GroupIcon = entry.icon;
  const childActive = entry.children.some((c) => c.to === activeTo);
  return (
    <Menu position="right-start" withinPortal shadow="md" offset={8}>
      <Menu.Target>
        <Tooltip label={label} position="right" withinPortal>
          <NavLink
            component="button"
            aria-label={label}
            aria-haspopup="menu"
            active={childActive}
            leftSection={<GroupIcon size={20} stroke={1.5} />}
            data-tour={entry.tourId}
            className={classes.railLink}
            ref={childActive ? setActiveTarget : undefined}
          />
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {entry.children.map(({ to, label: childLabel, icon: Icon }) => (
          <Menu.Item
            key={to}
            component={RouterLink}
            to={to}
            leftSection={<Icon size={16} stroke={1.5} />}
            aria-current={to === activeTo ? "page" : undefined}
            onClick={onNavigate}
          >
            {t(childLabel)}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The navbar body (v3.3.0): the resolved sections, each a labelled group of leaves and
 * collapsible groups; in rail mode the labels become hairlines and the groups right-anchored
 * menus. Every leaf keeps its accessible name, `aria-current`, and `data-tour` in both modes.
 */
export function AppNav({
  sections,
  activeTo,
  rail,
  onNavigate,
}: {
  sections: NavSection[];
  activeTo: string | null;
  rail: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const activeTargetRef = useRef<HTMLElement>(null);
  const setActiveTarget = useCallback((node: HTMLElement | null) => {
    activeTargetRef.current = node;
  }, []);
  const revealActive = useCallback(() => {
    const target = activeTargetRef.current;
    const viewport = target?.closest<HTMLElement>("[data-scrollarea-viewport]");
    if (!target || !viewport) return;

    const targetRect = target.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    if (targetRect.top < viewportRect.top) {
      viewport.scrollTop += Math.floor(targetRect.top - viewportRect.top);
    } else if (targetRect.bottom > viewportRect.bottom) {
      // scrollTop is pixel-rounded by browsers; round outward so a fractional edge stays visible.
      viewport.scrollTop += Math.ceil(targetRect.bottom - viewportRect.bottom);
    }
  }, []);

  // Route entry and rail/expanded switches can each replace the active target. Scroll only the
  // navbar viewport: scrollIntoView could also move the document, and scrollTop does not focus.
  useEffect(() => {
    revealActive();
  }, [activeTo, rail, revealActive]);

  return (
    <Stack gap={rail ? 4 : "md"} pb="xs">
      {sections.map((section, index) => (
        <div key={section.id} role="group" aria-label={t(section.label)}>
          {rail ? (
            index > 0 && <Divider my={4} mx={8} aria-hidden="true" />
          ) : (
            <Text size="xs" fw={600} c="dimmed" className={classes.sectionLabel}>
              {t(section.label)}
            </Text>
          )}
          {section.entries.map((entry) => {
            if (isGroup(entry)) {
              return rail ? (
                <NavGroupMenu
                  key={entry.label}
                  entry={entry}
                  activeTo={activeTo}
                  onNavigate={onNavigate}
                  setActiveTarget={setActiveTarget}
                />
              ) : (
                <NavGroupLink
                  key={entry.label}
                  entry={entry}
                  activeTo={activeTo}
                  onNavigate={onNavigate}
                  setActiveTarget={setActiveTarget}
                  revealActive={revealActive}
                />
              );
            }
            return (
              <NavLeafLink
                key={entry.to}
                leaf={entry}
                active={entry.to === activeTo}
                rail={rail}
                onNavigate={onNavigate}
                setActiveTarget={setActiveTarget}
              />
            );
          })}
        </div>
      ))}
    </Stack>
  );
}

/** The pinned navbar footer: the account leaf + Changelog (quiet), then the version stamp
 *  with its what's-new dot. The title carries the accessible "what's new" name only while
 *  the dot is shown. */
export function NavFooter({
  items,
  activeTo,
  rail,
  changelogUnseen,
  onNavigate,
}: {
  items: NavLeaf[];
  activeTo: string | null;
  rail: boolean;
  changelogUnseen: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AppShell.Section pt="xs" className={classes.footer}>
      {items.map((leaf) => (
        <NavLeafLink key={leaf.to} leaf={leaf} active={leaf.to === activeTo} rail={rail} quiet onNavigate={onNavigate} />
      ))}
      <Indicator
        color="red"
        size={8}
        disabled={!changelogUnseen}
        title={changelogUnseen ? t("changelog.whatsNew") : undefined}
      >
        <VersionStamp to="/changelog" ta="center" pt={4} compact={rail} />
      </Indicator>
    </AppShell.Section>
  );
}
