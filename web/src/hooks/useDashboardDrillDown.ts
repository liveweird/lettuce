import { useParams, useSearchParams } from "react-router-dom";

// Which dashboard tab a per-user drill-down (/users/:userId/…) was opened from — decides the
// "Back to …" link and the invalid-id redirect. Only the managers/subordinates grids link to
// these screens; defaults to managers for older links lacking `from`. ManagerFeedbacks has a
// wider origin set (users list, team rosters + teamId) and keeps its own resolver.
export const DASHBOARD_ORIGINS = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
  subordinates: { labelKey: "feedback.origin.subordinates", to: "/?tab=subordinates" },
} as const;

export type DashboardOriginKey = keyof typeof DASHBOARD_ORIGINS;

function isOriginKey(value: string | null): value is DashboardOriginKey {
  return value != null && value in DASHBOARD_ORIGINS;
}

/**
 * The shared scaffolding of the per-person drill-down screens (UserGoals, UserOneOnOnes):
 * parses `:userId` + `name`/`from`, resolves the origin, and rebuilds `backTo` — the drill-down's
 * own URL with origin preserved, handed to detail pages so a round-trip returns here intact.
 */
export function useDashboardDrillDown(basePath: string): {
  userId: number;
  idIsValid: boolean;
  name: string | null;
  originKey: DashboardOriginKey;
  origin: (typeof DASHBOARD_ORIGINS)[DashboardOriginKey];
  backTo: string;
} {
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const originKey: DashboardOriginKey = isOriginKey(fromParam) ? fromParam : "managers";

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  const queryString = query.toString();

  return {
    userId,
    idIsValid,
    name,
    originKey,
    origin: DASHBOARD_ORIGINS[originKey],
    backTo: `/users/${userId}/${basePath}${queryString ? `?${queryString}` : ""}`,
  };
}
