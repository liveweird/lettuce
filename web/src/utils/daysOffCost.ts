// The pure client-side mirror of the server's working-day cost math (daysoff/DaysOff.kt) —
// drives the create form's live preview. Half-day integer units keep it exact; the server's
// stored cost is authoritative (frozen at creation), this only previews.

/** The server's allowance ceiling (MAX_PAID_DAYS_OFF_ALLOWANCE in daysoff/DaysOff.kt). */
export const MAX_PAID_DAYS_OFF_ALLOWANCE = 365;

/** True when the ISO date is a working day: not Saturday/Sunday and not a public holiday. */
export function isWorkingDay(iso: string, holidays: Set<string>): boolean {
  // Date.UTC keeps the weekday independent of the viewer's timezone.
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(iso);
}

function nextIsoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The period's cost in half-day units: a working day costs 2, minus 1 when it is the first day
 * and startHalf, minus 1 when it is the last day and endHalf (a half toggle on a non-working
 * edge day subtracts nothing — the day already costs 0). Returns null on an invalid range.
 */
export function costHalfDays(
  startIso: string,
  endIso: string,
  startHalf: boolean,
  endHalf: boolean,
  holidays: Set<string>,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return null;
  if (startIso > endIso) return null;
  let cost = 0;
  let day = startIso;
  let guard = 0;
  while (day <= endIso && guard < 400) {
    if (isWorkingDay(day, holidays)) {
      let units = 2;
      if (day === startIso && startHalf) units -= 1;
      if (day === endIso && endHalf) units -= 1;
      cost += units;
    }
    day = nextIsoDay(day);
    guard += 1;
  }
  return cost;
}

/** Locale-aware "1.5"-style days number (halves are the only fraction that occurs). */
export function formatDays(days: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(days);
}

