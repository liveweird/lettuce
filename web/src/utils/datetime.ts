// Epoch millis -> "YYYY-MM-DD HH:mm" in local time.
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// Recency windows for the "Last modified" list filter.
export type LastModifiedWindow = "all" | "week" | "month";

export const LAST_MODIFIED_OPTIONS = [
  { value: "all", label: "All" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Epoch-millis lower bound for the window, or undefined for "all".
// Rolling windows, recomputed per call so they always track "now".
export function lastModifiedCutoff(w: LastModifiedWindow): number | undefined {
  if (w === "week") return Date.now() - 7 * DAY_MS;
  if (w === "month") return Date.now() - 30 * DAY_MS;
  return undefined;
}
