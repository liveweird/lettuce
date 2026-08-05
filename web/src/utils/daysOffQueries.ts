import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything a days-off mutation can affect, in one place (the goalQueries
 * pattern): the request lists, the calendar, the budgets, and the bell. Awaits only the list
 * (what the current screen re-renders from); the rest refetch in the background.
 */
export async function invalidateDaysOff(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["daysOff"] });
  queryClient.invalidateQueries({ queryKey: ["daysOffCalendar"] });
  queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

/** A correction mutation refreshes the corrections list and every budget surface. */
export async function invalidateDaysOffCorrections(queryClient: QueryClient, userId: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["daysOffCorrections", userId] });
  queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}
