import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listReviewPeriods, type ReviewPeriod } from "../api/client";
import { formatMonthRange } from "../utils/datetime";

// The one cached review-periods query (the ["reviewPeriods"] key is shared with every
// mutation's invalidation) mapped to Mantine Select options, newest first — the
// useDictionaryOptions shape. Consumers that need the raw timeline (the admin screen,
// the dashboard's empty check) read `periods`; the pickers read `options`.
export function useReviewPeriodOptions(enabled = true): {
  periods: ReviewPeriod[] | undefined;
  options: { value: string; label: string }[];
  isLoading: boolean;
  isError: boolean;
} {
  const { i18n } = useTranslation();
  const { data: periods, isLoading, isError } = useQuery({
    queryKey: ["reviewPeriods"],
    queryFn: listReviewPeriods,
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const options = useMemo(
    () =>
      [...(periods ?? [])].reverse().map((p) => ({
        value: String(p.id),
        label: formatMonthRange(p.startMonth, p.endMonth, i18n.language),
      })),
    [periods, i18n.language],
  );

  return { periods, options, isLoading, isError };
}
