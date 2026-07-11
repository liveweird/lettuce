import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listUsers } from "../api/client";

const MANAGER_PICKER_PAGE_SIZE = 100;

// The shared manager-picker pool: one cached, name-sorted page of users mapped to Mantine
// Select options. Used by the Teams list filter and the Create/Edit team forms (which pass
// `enabled: isAdmin()` since only admins see their picker).
export function useManagerOptions(enabled = true): {
  managerOptions: { value: string; label: string }[];
  managersLoading: boolean;
} {
  const { data: managerPool, isLoading: managersLoading } = useQuery({
    queryKey: ["users", "managerPicker"],
    queryFn: () => listUsers({ page: 1, pageSize: MANAGER_PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const managerOptions = useMemo(
    () =>
      (managerPool?.items ?? []).map((u) => ({
        value: String(u.id),
        label: u.name,
      })),
    [managerPool],
  );

  return { managerOptions, managersLoading };
}
