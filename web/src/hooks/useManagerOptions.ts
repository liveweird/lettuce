import { useMemo } from "react";
import { useAllUsers } from "./useAllUsers";

// The shared manager-picker pool: EVERY user (via the shared useAllUsers pool — one cache
// for every picker; a single capped page silently dropped anyone past the first 100 by
// name, v1.51.0 fix), name-sorted client-side and mapped to Mantine Select options. Used by
// the Teams list filter and the Create/Edit team forms (which pass `enabled: isAdmin()`
// since only admins see their picker).
export function useManagerOptions(enabled = true): {
  managerOptions: { value: string; label: string }[];
  managersLoading: boolean;
} {
  const { userPool: managerPool, usersLoading: managersLoading } = useAllUsers(enabled);

  const managerOptions = useMemo(
    () =>
      (managerPool ?? [])
        .map((u) => ({ value: String(u.id), label: u.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [managerPool],
  );

  return { managerOptions, managersLoading };
}
