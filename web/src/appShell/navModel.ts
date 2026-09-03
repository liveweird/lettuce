import type { ParseKeys } from "i18next";
import type { Icon } from "@tabler/icons-react";
import {
  IconBeach,
  IconBook2,
  IconBriefcase,
  IconCalendarEvent,
  IconCalendarOff,
  IconCalendarStats,
  IconChartLine,
  IconClipboardText,
  IconConfetti,
  IconFileText,
  IconHeartRateMonitor,
  IconHierarchy,
  IconHistory,
  IconKey,
  IconLayoutDashboard,
  IconMessageCircle,
  IconNotebook,
  IconPlugConnected,
  IconRoute,
  IconSettings,
  IconSpeakerphone,
  IconStack2,
  IconStairs,
  IconStairsUp,
  IconTargetArrow,
  IconToggleLeft,
  IconUserShield,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { Feature } from "../api/session";

export type NavLeaf = {
  to: string;
  /** An i18n key, resolved with t() at render time. */
  label: ParseKeys;
  icon: Icon;
  /** Becomes the `data-tour` attribute the guided tour anchors to. */
  tourId?: string;
  /** Renders only while the session user has the feature enabled (v1.53.0). */
  feature?: Feature;
  /** Renders only for callers who manage a team (v2.42.0 — Succession plans). Resolved via
   *  useIsManager() in the Shell, an ASYNC query: the leaf pops in once the probe answers. */
  managerOnly?: boolean;
  /** Renders only for ADMIN callers (the Config leaves whose pages are admin-only end to end). */
  adminOnly?: boolean;
};
export type NavGroup = { label: ParseKeys; icon: Icon; children: NavLeaf[]; tourId?: string };
export type NavEntry = NavLeaf | NavGroup;
export const isGroup = (e: NavEntry): e is NavGroup => "children" in e;

type NavSectionId = "overview" | "myWork" | "team" | "administration";
export type NavSection = { id: NavSectionId; label: ParseKeys; entries: NavEntry[] };

// The grouped navigation (v3.3.0). Leaf names, icons, tour anchors, and gates are the
// pre-v3.3.0 ones — only the grouping is new. A section renders only while it has a visible
// entry; no section label may equal a group button's text ("Config", "Dictionaries").
const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    id: "overview",
    label: "appShell.navSection.overview",
    entries: [
      { to: "/", label: "appShell.nav.dashboard", icon: IconLayoutDashboard, tourId: "nav-dashboard" },
      { to: "/kudos", label: "appShell.nav.kudos", icon: IconConfetti, tourId: "nav-kudos", feature: "FEEDBACKS" },
    ],
  },
  {
    id: "myWork",
    label: "appShell.navSection.myWork",
    entries: [
      { to: "/feedback", label: "appShell.nav.feedback", icon: IconMessageCircle, tourId: "nav-feedback", feature: "FEEDBACKS" },
      { to: "/one-on-ones", label: "appShell.nav.oneOnOnes", icon: IconCalendarEvent, tourId: "nav-one-on-ones", feature: "ONE_ON_ONES" },
      { to: "/goals", label: "appShell.nav.goals", icon: IconTargetArrow, tourId: "nav-my-goals", feature: "GOALS" },
      { to: "/impact-log", label: "appShell.nav.impactLog", icon: IconNotebook, tourId: "nav-impact-log", feature: "IMPACT_LOG" },
      // Deliberately feature-UNGATED — the whole career area is (FEATURE_OF.career = null).
      { to: "/career", label: "appShell.nav.career", icon: IconStairsUp, tourId: "nav-career" },
      { to: "/days-off", label: "appShell.nav.daysOff", icon: IconBeach, tourId: "nav-days-off", feature: "DAYS_OFF" },
    ],
  },
  {
    id: "team",
    label: "appShell.navSection.team",
    entries: [
      { to: "/team-kpis", label: "appShell.nav.teamKpis", icon: IconChartLine, tourId: "nav-team-kpis", feature: "TEAM_KPIS" },
      {
        to: "/performance",
        label: "appShell.nav.performance",
        icon: IconClipboardText,
        tourId: "nav-performance",
        feature: "PERFORMANCE_REVIEWS",
      },
      { to: "/pulse", label: "appShell.nav.pulse", icon: IconHeartRateMonitor, tourId: "nav-pulse", feature: "PULSE_SURVEYS" },
      {
        to: "/succession",
        label: "appShell.nav.succession",
        icon: IconUserShield,
        tourId: "nav-succession",
        feature: "SUCCESSION_PLANS",
        managerOnly: true,
      },
    ],
  },
  {
    id: "administration",
    label: "appShell.navSection.administration",
    entries: [
      {
        label: "appShell.nav.config",
        icon: IconSettings,
        tourId: "nav-config",
        children: [
          { to: "/users", label: "appShell.nav.users", icon: IconUsers },
          { to: "/teams", label: "appShell.nav.teams", icon: IconUsersGroup },
          { to: "/org", label: "appShell.nav.orgChart", icon: IconHierarchy },
          { to: "/templates", label: "appShell.nav.templates", icon: IconFileText },
          // Readable by everyone since v1.34.1 (the Templates precedent) — the page itself
          // renders read-only for non-admins; append/delete stay ADMIN-gated.
          { to: "/review-periods", label: "appShell.nav.reviewPeriods", icon: IconCalendarStats, feature: "PERFORMANCE_REVIEWS" },
          // Same posture: the registry read is open, adding/deleting is ADMIN-only.
          { to: "/public-holidays", label: "appShell.nav.publicHolidays", icon: IconCalendarOff, feature: "DAYS_OFF" },
          // The paid pool kinds registry (v3.2.0) — the same everyone-reads/admin-writes posture.
          { to: "/days-off-pools", label: "appShell.nav.daysOffPools", icon: IconStack2, feature: "DAYS_OFF" },
          // Admin-only end to end (reads included), so non-admins don't get the entries.
          {
            to: "/pulse-cycles",
            label: "appShell.nav.pulseCycles",
            icon: IconHeartRateMonitor,
            feature: "PULSE_SURVEYS",
            adminOnly: true,
          },
          { to: "/feature-flags", label: "appShell.nav.featureFlags", icon: IconToggleLeft, adminOnly: true },
          { to: "/integration-clients", label: "appShell.nav.integrationClients", icon: IconPlugConnected, adminOnly: true },
          { to: "/alerts", label: "appShell.nav.alerts", icon: IconSpeakerphone, adminOnly: true },
        ],
      },
      // Visible to everyone: the pages are readable by all, only editing is ADMIN-gated.
      {
        label: "appShell.nav.dictionaries",
        icon: IconBook2,
        // One group-level tour step stands in for all four leaves (they are the same editor over
        // different lists), unlike Config, whose leaves are genuinely distinct screens.
        tourId: "nav-dictionaries",
        children: [
          { to: "/dictionaries/career-paths", label: "appShell.nav.careerPaths", icon: IconRoute },
          { to: "/dictionaries/career-specializations", label: "appShell.nav.careerSpecializations", icon: IconBriefcase },
          { to: "/dictionaries/seniority-levels", label: "appShell.nav.seniorityLevels", icon: IconStairs },
          // Feature-tagged in the NAV only — the dictionaries area itself stays ungated
          // server-side (the career dictionaries posture).
          {
            to: "/dictionaries/pulse-rotating-questions",
            label: "appShell.nav.pulseRotatingQuestions",
            icon: IconHeartRateMonitor,
            feature: "PULSE_SURVEYS",
          },
        ],
      },
    ],
  },
];

// The quiet footer: the account item, then the Changelog pinned directly above the version
// stamp it pairs with.
const CHANGELOG_NAV: NavLeaf = {
  to: "/changelog",
  label: "appShell.nav.changelog",
  icon: IconHistory,
  tourId: "nav-changelog",
};

export type NavGates = {
  isAdmin: boolean;
  isManager: boolean;
  hasFeature: (feature: Feature) => boolean;
};

export type ResolvedNav = { sections: NavSection[]; footer: NavLeaf[]; leafTos: string[] };

/** Applies the feature/manager/admin gates: drops hidden leaves, groups emptied by them, and
 *  sections left without an entry, and lists every visible leaf path for active-highlighting. */
export function resolveNav(gates: NavGates, userId: number | null): ResolvedNav {
  const leafVisible = (leaf: NavLeaf) =>
    (!leaf.feature || gates.hasFeature(leaf.feature)) &&
    (!leaf.managerOnly || gates.isManager) &&
    (!leaf.adminOnly || gates.isAdmin);
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries
      .map((e) => (isGroup(e) ? { ...e, children: e.children.filter(leafVisible) } : e))
      .filter((e) => (isGroup(e) ? e.children.length > 0 : leafVisible(e))),
  })).filter((section) => section.entries.length > 0);
  const footer: NavLeaf[] = [
    ...(userId === null
      ? []
      : [{ to: `/users/${userId}/change-password`, label: "appShell.nav.changePassword" as const, icon: IconKey, tourId: "nav-change-password" }]),
    CHANGELOG_NAV,
  ];
  const leafTos = [
    ...sections.flatMap((s) => s.entries.flatMap((e) => (isGroup(e) ? e.children.map((c) => c.to) : [e.to]))),
    ...footer.map((l) => l.to),
  ];
  return { sections, footer, leafTos };
}

/** The active leaf for a pathname: the longest matching path ("/" only matches exactly). */
export function activeLeaf(leafTos: string[], pathname: string): string | null {
  const matches = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  return leafTos.filter(matches).sort((a, b) => b.length - a.length)[0] ?? null;
}
