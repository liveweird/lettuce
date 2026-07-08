import { useQuery } from "@tanstack/react-query";
import { getVisibleAlerts } from "../api/client";

/** Height of the permanent slim strip the alerts banner adds above the app header. */
export const ALERTS_BAR_HEIGHT = 30;

/**
 * The currently visible alerts, refetched every minute. Shared by Shell (which sizes the
 * AppShell header) and AlertsBanner — react-query dedupes the identical key to one fetch.
 */
export function useVisibleAlerts() {
  return useQuery({
    queryKey: ["visibleAlerts"],
    queryFn: getVisibleAlerts,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  });
}
