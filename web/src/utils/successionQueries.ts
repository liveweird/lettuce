import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a succession-plan mutation can affect, in one place (the goalQueries
 * pattern): the plan lists and the single-plan document (nominations embed there). No bell —
 * succession planning deliberately mints no notifications (confidential by design).
 */
export async function invalidateSuccession(queryClient: QueryClient, id?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["succession"] });
  await queryClient.invalidateQueries({ queryKey: ["successionPlanEvents"] });
  if (id != null) await queryClient.invalidateQueries({ queryKey: ["successionPlan", id] });
}
