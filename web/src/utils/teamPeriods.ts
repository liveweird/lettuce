// Shared helpers for the dated team structure (v4.17.0): a membership or manager period is
// "current" when it covers today (the server says so), "upcoming" when it starts after today,
// and "past" otherwise. A null start means "since before records began", so it is never upcoming.

import { todayIsoDate } from "./datetime";

export type PeriodStatus = "current" | "past" | "upcoming";

export function periodStatus(
  period: { startDate: string | null; current: boolean },
  today: string = todayIsoDate(),
): PeriodStatus {
  if (period.current) return "current";
  if (period.startDate != null && period.startDate > today) return "upcoming";
  return "past";
}

/** Newest first by start date, periods that begin "before records" last (they are the oldest). */
export function newestFirstPeriods<T extends { startDate: string | null; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.startDate === b.startDate) return b.id - a.id;
    if (a.startDate == null) return 1;
    if (b.startDate == null) return -1;
    return a.startDate < b.startDate ? 1 : -1;
  });
}
