// Epoch millis -> "YYYY-MM-DD HH:mm" in local time.
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// Epoch millis -> a localized relative phrase ("2 days ago"), picking the largest unit that
// has a non-zero value. Intl handles the per-language plural rules, so no i18n keys needed.
export function formatRelativeTime(ms: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 60) return rtf.format(0, "minute"); // "this minute" / "w tej minucie"
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, sec] of units) {
    if (abs >= sec) return rtf.format(Math.trunc(deltaSec / sec), unit);
  }
  return rtf.format(0, "minute");
}

// ISO "YYYY-MM-DD" -> a localized date ("Jul 1, 2026" / "1 lip 2026"). The T00:00:00 suffix
// pins parsing to local time (a bare ISO date would parse as UTC and shift across midnight).
// Malformed input renders as-is rather than "Invalid Date".
export function formatIsoDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

// Today's date as the ISO "YYYY-MM-DD" an <input type="date"> uses (local time).
export function todayIsoDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Epoch millis -> value for an <input type="datetime-local"> ("YYYY-MM-DDTHH:mm", local time).
// Null/undefined -> "" (the input's "unset" value).
export function epochToDatetimeLocal(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// <input type="datetime-local"> value -> epoch millis; "" (unset) -> null.
export function datetimeLocalToEpoch(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Epoch millis -> a localized absolute date ("Jul 1, 2026" / "1 lip 2026"), no time part.
// Used where the moment matters at day granularity over long spans (a goal's creation date) —
// relative phrasing degrades into "3 months ago" there.
export function formatDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}

// Recency windows for the "Last modified" list filter.
export type LastModifiedWindow = "all" | "week" | "month";

// Built from a translator so the labels stay localized; callers pass their `t` from useTranslation.
export function lastModifiedOptions(t: (key: string) => string) {
  return [
    { value: "all", label: t("common.state.all") },
    { value: "week", label: t("feedback.lastWeek") },
    { value: "month", label: t("feedback.lastMonth") },
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Epoch-millis lower bound for the window, or undefined for "all".
// Rolling windows, recomputed per call so they always track "now".
export function lastModifiedCutoff(w: LastModifiedWindow): number | undefined {
  if (w === "week") return Date.now() - 7 * DAY_MS;
  if (w === "month") return Date.now() - 30 * DAY_MS;
  return undefined;
}

// Creation-date windows for the goals list filter (goals live for months, so the windows are
// wider than the lastModified ones).
export type CreatedWindow = "all" | "month" | "sixMonths";

export function createdWindowOptions(t: (key: string) => string) {
  return [
    { value: "all", label: t("common.state.all") },
    { value: "month", label: t("goal.createdWindow.month") },
    { value: "sixMonths", label: t("goal.createdWindow.sixMonths") },
  ];
}

export function createdWindowCutoff(w: CreatedWindow): number | undefined {
  if (w === "month") return Date.now() - 30 * DAY_MS;
  if (w === "sixMonths") return Date.now() - 182 * DAY_MS;
  return undefined;
}
