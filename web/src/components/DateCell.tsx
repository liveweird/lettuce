import { Text, type MantineSize } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatIsoDate, formatRelativeTime, formatTimestamp } from "../utils/datetime";

export type DateCellMode = "relative" | "absolute" | "date";

/**
 * The one way a date/time renders in lists and cards (v3.3.0):
 * - `relative` — activity timestamps ("last modified", "last used", card stats): a localized
 *   "2 days ago" with the exact timestamp in the `title`;
 * - `absolute` — event timestamps (history rows, alert bounds): the exact timestamp;
 * - `date` — planned ISO dates (due, start/end, holidays): the localized medium date.
 * `value` is epoch milliseconds for the timestamp modes and an ISO "YYYY-MM-DD" for `date`;
 * a missing value renders the dash.
 */
export default function DateCell({
  value,
  mode = "relative",
  size = "sm",
  emptyLabel = "—",
  dimmed = false,
}: {
  value: number | string | null | undefined;
  mode?: DateCellMode;
  size?: MantineSize;
  emptyLabel?: string;
  /** Secondary lines (a row's timestamp under its text). */
  dimmed?: boolean;
}) {
  const { i18n } = useTranslation();
  if (value == null || value === "") {
    return (
      <Text size={size} c="dimmed" component="span">
        {emptyLabel}
      </Text>
    );
  }
  const color = dimmed ? "dimmed" : undefined;
  if (mode === "date") {
    return (
      <Text size={size} component="span" c={color}>
        {formatIsoDate(String(value), i18n.language)}
      </Text>
    );
  }
  const ms = Number(value);
  const exact = formatTimestamp(ms);
  return (
    <Text size={size} component="span" c={color} title={mode === "relative" ? exact : undefined}>
      {mode === "relative" ? formatRelativeTime(ms, i18n.language) : exact}
    </Text>
  );
}
