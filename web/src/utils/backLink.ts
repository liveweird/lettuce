import type { ParseKeys } from "i18next";
import { navLeafLabel } from "../appShell/navModel";
import { inAppPath } from "./url";

// The "← Back to …" label for a return destination carried as `?back=` (v4.6.0). The label is
// derived from the destination's own shape — NEVER from URL text (a crafted `back` must not be
// able to put words on the page): a closed table of known surfaces, else the neutral fallback.
const DASHBOARD_TAB_LABEL = {
  managers: "dashboard.tabs.managers",
  peers: "dashboard.tabs.peers",
  subordinates: "dashboard.tabs.subordinates",
  myTeams: "dashboard.tabs.myTeams",
} as const satisfies Record<string, ParseKeys>;

function isDashboardTab(tab: string | null): tab is keyof typeof DASHBOARD_TAB_LABEL {
  return tab != null && tab in DASHBOARD_TAB_LABEL;
}

/** The i18n key naming a return destination, for the `feedback.backToLabel` template. */
export function backLabelKey(path: string): ParseKeys {
  const safe = inAppPath(path);
  if (safe == null) return "feedback.origin.previous";
  const [withoutHash] = safe.split("#");
  const queryAt = withoutHash.indexOf("?");
  const pathname = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const search = new URLSearchParams(queryAt === -1 ? "" : withoutHash.slice(queryAt + 1));
  if (pathname === "/") {
    const tab = search.get("tab");
    if (isDashboardTab(tab)) return DASHBOARD_TAB_LABEL[tab];
  }
  if (/^\/users\/\d+\/details$/.test(pathname)) return "feedback.origin.details";
  if (/^\/teams\/\d+\/details$/.test(pathname)) return "teams.detailsTitle";
  return navLeafLabel(pathname) ?? "feedback.origin.previous";
}

/**
 * The precedence rule in one place (settled in v1.39.0): the `back` override wins the
 * DESTINATION; the recognised `from` key (when the URL carried one) keeps naming the label;
 * a back-only visit is labelled after where it returns to.
 */
export function resolveBackLink(opts: {
  fromLabelKey?: ParseKeys;
  backOverride: string | null;
  defaultTo: string;
}): { to: string; labelKey: ParseKeys } {
  const to = opts.backOverride ?? opts.defaultTo;
  return { to, labelKey: opts.fromLabelKey ?? backLabelKey(to) };
}
