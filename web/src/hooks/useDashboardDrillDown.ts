import { useParams, useSearchParams } from "react-router-dom";
import { canAudit } from "../api/client";
import { userDetailsLink } from "../utils/userLinks";

// Which screen a per-user drill-down (/users/:userId/…) was opened from — decides the
// "Back to …" link and the invalid-id redirect. The managers/subordinates grids and the
// team-scoped subordinates view link to these screens; defaults to managers for older links
// lacking `from`. ManagerFeedbacks has a wider origin set (users list, team rosters + teamId)
// and keeps its own resolver.
export const DASHBOARD_ORIGINS = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
  subordinates: { labelKey: "feedback.origin.subordinates", to: "/?tab=subordinates" },
} as const;

// `team` is the parameterized origin (the ManagerFeedbacks `members` precedent): its back
// target needs the `teamId` param, so it has no static entry in DASHBOARD_ORIGINS. `details`
// returns to the person's read-only details page (the audit-mode entry point).
export type DashboardOriginKey = keyof typeof DASHBOARD_ORIGINS | "team" | "details";

function isStaticOriginKey(value: string | null): value is keyof typeof DASHBOARD_ORIGINS {
  return value != null && value in DASHBOARD_ORIGINS;
}

function parsePositiveInt(value: string | null): number | null {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The shared scaffolding of the per-person drill-down screens (UserGoals, UserOneOnOnes):
 * parses `:userId` + `name`/`from` (+ `teamId` for the team origin), resolves the origin, and
 * rebuilds `backTo` — the drill-down's own URL with origin preserved, handed to detail pages so
 * a round-trip returns here intact. `from=team` without a valid teamId degrades to `managers`
 * (the ManagerFeedbacks `members` rule). `callerManages` is true for the origins where the
 * caller is the manager of the viewed person (subordinates grid, team view) — the gate for
 * manager-only affordances.
 */
export function useDashboardDrillDown(basePath: string): {
  userId: number;
  idIsValid: boolean;
  name: string | null;
  originKey: DashboardOriginKey;
  origin: { labelKey: string; to: string };
  callerManages: boolean;
  /** `?mode=audit` requested by an HR caller: the page renders the auditor view. */
  auditMode: boolean;
  backTo: string;
} {
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const teamId = parsePositiveInt(searchParams.get("teamId"));
  // Explicit return override (the details-page round-trip: `from` alone would lose the
  // details page's own origin). In-app paths only — anything else is ignored.
  const backParam = searchParams.get("back");
  const backOverride = backParam?.startsWith("/") ? backParam : null;
  // The caller-manages assertion for origins that can't prove it (`from=details`): set by
  // the details page's direct-report flavor so the manager-only affordances survive.
  const managesParam = searchParams.get("manages") === "1";
  // Non-auditors silently fall back to the normal mode (the EditGoal self-heal spirit).
  const auditMode = searchParams.get("mode") === "audit" && canAudit();

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  const originKey: DashboardOriginKey =
    fromParam === "details"
      ? "details"
      : fromParam === "team" && teamId != null
        ? "team"
        : isStaticOriginKey(fromParam)
          ? fromParam
          : "managers";
  const resolved =
    originKey === "team"
      ? { labelKey: "feedback.origin.team", to: `/teams/${teamId}/subordinates` }
      : originKey === "details"
        ? { labelKey: "feedback.origin.details", to: userDetailsLink(userId, name) }
        : DASHBOARD_ORIGINS[originKey];
  // The back override wins for the destination; the origin key keeps naming the label.
  const origin = backOverride ? { labelKey: resolved.labelKey, to: backOverride } : resolved;

  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (originKey !== "managers" || fromParam === "managers") query.set("from", originKey);
  if (originKey === "team") query.set("teamId", String(teamId));
  if (backOverride) query.set("back", backOverride);
  if (managesParam) query.set("manages", "1");
  if (auditMode) query.set("mode", "audit");
  const queryString = query.toString();

  return {
    userId,
    idIsValid,
    name,
    originKey,
    origin,
    callerManages:
      !auditMode && (managesParam || (originKey !== "managers" && originKey !== "details")),
    auditMode,
    backTo: `/users/${userId}/${basePath}${queryString ? `?${queryString}` : ""}`,
  };
}
