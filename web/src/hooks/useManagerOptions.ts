import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAllUsers } from "../api/client";

// The shared manager-picker pool: EVERY user (paged via listAllUsers — a single capped page
// silently dropped anyone past the first 100 by name, v1.51.0 fix), name-sorted client-side
// and mapped to Mantine Select options. Used by the Teams list filter and the Create/Edit
// team forms (which pass `enabled: isAdmin()` since only admins see their picker).
export function useManagerOptions(enabled = true): {
  managerOptions: { value: string; label: string }[];
  managersLoading: boolean;
} {
  const { data: managerPool, isLoading: managersLoading } = useQuery({
    queryKey: ["users", "managerPicker"],
    queryFn: () => listAllUsers(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const managerOptions = useMemo(
    () =>
      (managerPool ?? [])
        .map((u) => ({ value: String(u.id), label: u.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [managerPool],
  );

  return { managerOptions, managersLoading };
}
