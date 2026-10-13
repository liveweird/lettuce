import { isOneOfOrNull, useStoredState } from "./useStoredState";

// The Any / Active / Inactive account-status filter state shared by /users and the person-card
// grids and rosters. The stored value mirrors the API's `deactivated` boolean as a string:
// "false" = Active only (THE DEFAULT), "true" = Inactive only, null = Any (an
// explicit choice — clearing the Select — so it persists as such and wins over the default).
export type AccountStatus = "true" | "false" | null;

export const DEFAULT_ACCOUNT_STATUS: AccountStatus = "false";

/**
 * The persisted account-status filter under `<viewKey>.filter.accountStatus`. The key is NOT the
 * pre-v4.16.0 `.filter.deactivated` on purpose: that key held `null` for an old "Clear filters"
 * (the old default was Any), which would have pinned many admins to Any forever — a fresh key
 * lets the Active default apply once, and the old one is simply orphaned (the multi-value-filter
 * convention in `web/docs/list-pages.md`).
 */
export function useAccountStatusFilter(viewKey: string) {
  return useStoredState<AccountStatus>(
    `${viewKey}.filter.accountStatus`,
    DEFAULT_ACCOUNT_STATUS,
    isOneOfOrNull(["true", "false"]),
  );
}

/** The `deactivated` query param for a filter value (undefined = Any, sent as no param). */
export function deactivatedParam(status: AccountStatus): boolean | undefined {
  return status == null ? undefined : status === "true";
}

/** Whether a filter value counts as an applied filter (anything but the default). */
export function isStatusFilterActive(status: AccountStatus): boolean {
  return status !== DEFAULT_ACCOUNT_STATUS;
}

/** The client-side predicate for rosters that load every page (ReviewsDashboard). */
export function matchesAccountStatus(status: AccountStatus, deactivated: boolean): boolean {
  return status == null || deactivated === (status === "true");
}
