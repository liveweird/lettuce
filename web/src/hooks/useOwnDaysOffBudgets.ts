import { useQuery } from "@tanstack/react-query";
import { listDaysOffBudgets } from "../api/daysoff";

/** The caller's own budgets query — one cache entry shared by the budget card and the page that
 *  sequences its layout around the card (DaysOff's requests tab). */
export function useOwnDaysOffBudgets(year: number) {
  return useQuery({
    queryKey: ["daysOffBudgets", "own", year],
    queryFn: () => listDaysOffBudgets("own", year),
  });
}
