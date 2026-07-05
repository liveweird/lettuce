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
