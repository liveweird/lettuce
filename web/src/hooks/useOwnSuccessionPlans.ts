import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAllOwnOpenSuccessionPlans } from "../api/successionPlans";
import { hasFeature } from "../api/session";

/**
 * The caller's own OPEN succession plans as a (seat userId → plan id) map — the pool behind
 * the person-card "Succession plan" button (v2.47.0, the useManagedReports shape). The
 * `["succession", …]` key prefix rides `invalidateSuccession`, so the button appears and
 * disappears with plan creates/closes/deletes without extra wiring. Callers gate `enabled`
 * to the managed flavor; the feature flag is ANDed here so a disabled caller never fires
 * the (403-bound) request.
 */
export function useOwnSuccessionPlans(enabled: boolean): {
  openPlanByUserId: Map<number, number>;
} {
  const { data } = useQuery({
    queryKey: ["succession", "ownOpenByUser"],
    queryFn: listAllOwnOpenSuccessionPlans,
    staleTime: 5 * 60 * 1000,
    enabled: enabled && hasFeature("SUCCESSION_PLANS"),
  });
  const openPlanByUserId = useMemo(
    () => new Map((data ?? []).map((plan) => [plan.userId, plan.id])),
    [data],
  );
  return { openPlanByUserId };
}
