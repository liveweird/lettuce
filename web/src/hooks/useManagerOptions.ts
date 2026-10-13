import { useMemo } from "react";
import { activeOnly, userOption, type UserOption } from "../components/userOptions";
import { useAllUsers } from "./useAllUsers";

// The shared manager-picker pool: EVERY user (via the shared useAllUsers pool — one cache
// for every picker; a single capped page silently dropped anyone past the first 100 by
// name, v1.51.0 fix), name-sorted client-side and mapped to team-aware Mantine Select options.
// Used by the Create/Edit team forms via TeamFormFields (which pass `enabled: isAdmin()` since
// only admins see their picker) — any ACTIVE user may become a manager; `keepIds` are the
// already-selected values (the team's current manager on edit) that stay offered even when since
// deactivated (the activeOnly picker rule). The Teams list's manager FILTER no longer uses it
// (v4.15.0): it lists the current managers from the all-teams rows.
export function useManagerOptions(
  enabled = true,
  keepIds: readonly number[] = [],
): {
  managerOptions: UserOption[];
  managersLoading: boolean;
  managersError: boolean;
} {
  const {
    userPool: managerPool,
    usersLoading: managersLoading,
    usersError: managersError,
  } = useAllUsers(enabled);

  // keepIds is a fresh array on every render — the memo keys on its content instead.
  const keepKey = keepIds.join(",");
  const managerOptions = useMemo(
    () =>
      activeOnly(managerPool ?? [], keepKey ? keepKey.split(",").map(Number) : [])
        .map((u) => userOption(u.id, u.name, (u.teams ?? []).map((team) => team.name)))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [managerPool, keepKey],
  );

  return { managerOptions, managersLoading, managersError };
}
