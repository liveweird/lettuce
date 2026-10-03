import { useEffect, useId, useRef, type ReactNode } from "react";
import { Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { DaysOffCalendarEntry, DaysOffCalendarResponse, DaysOffCalendarUser } from "../api/daysoff";
import { getUserId } from "../api/session";
import { todayIsoDate } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import classes from "./DaysOffMonthGrid.module.css";

// The month's ISO dates, 1..last day.
function monthDates(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// The column shading (with a leading space for className concatenation): a public holiday's
// warm tint wins over the weekend gray when both apply.
function offDayClass(holiday: boolean, weekend: boolean): string {
  if (holiday) return ` ${classes.holidayDay}`;
  if (weekend) return ` ${classes.weekendDay}`;
  return "";
}

function fillClass(entry: DaysOffCalendarEntry): string {
  const color = entry.type === "PAID" ? classes.paid : classes.unpaid;
  return `${classes.fill} ${color}${entry.half ? ` ${classes.half}` : ""}`;
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span className={`${classes.legendSwatch} ${swatch}`} aria-hidden />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

/**
 * The leave-planner grid: rows = people in the scope, columns = the month's days. Weekend and
 * holiday columns are dimmed (the holiday's name rides the column header tooltip); every active
 * entry renders as a solid bar (PAID teal / UNPAID gray — no lifecycle since v3.9.0, so nothing
 * is tentative), half days as half-filled cells. A real `<table>` with per-cell `title`
 * descriptions; hand-rolled — no calendar dependency. `showTeams` (v3.13.0, the managed scope
 * only — a widened chain view says where each report sits) renders a dimmed team-name line
 * under a row's name, mirroring the person-picker subtitle idiom; never on the caller's own row.
 * Today's column (v4.7.0) is marked in its header (accent + aria-current) and with thin inset
 * edge lines down the column — never a fill, so an entry on today reads like any other day.
 * The "Shared with me" scope (v4.11.0) adds a dimmed "Shared by {name}" line under a row whose
 * `sharedBy` is set; `renderRowAction` is a slot right of the name for a per-row action (the page
 * renders the server-gated Share icon through it — the grid knows nothing about sharing rules);
 * `highlightUserId` marks one row (`aria-current="true"`, an accent bar on its name cell) and
 * scrolls it into view — the notification / Shared-screen deep link's `user` param.
 */
export default function DaysOffMonthGrid({
  data,
  showTeams = false,
  renderRowAction,
  highlightUserId,
}: {
  data: DaysOffCalendarResponse;
  showTeams?: boolean;
  renderRowAction?: (user: DaysOffCalendarUser) => ReactNode;
  highlightUserId?: number | null;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const dates = monthDates(data.month);
  const holidayNames = new Map(data.holidays.map((h) => [h.date, h.name]));
  // Today (the viewer's local date, v4.7.0): the header cell carries the accent and
  // aria-current, every body cell a thin inset edge line — never a fill, so who is off stays
  // exactly as readable as on any other day. Only when the shown month contains it.
  const today = todayIsoDate();
  const showsToday = dates.includes(today);
  const todayClass = (iso: string, className: string) => (iso === today ? ` ${className}` : "");
  const idPrefix = useId();
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const hasHighlightedRow = highlightUserId != null && data.users.some((u) => u.userId === highlightUserId);
  useEffect(() => {
    // happy-dom (and very old browsers) lack scrollIntoView; the highlight itself still renders.
    if (hasHighlightedRow) highlightRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [hasHighlightedRow, highlightUserId]);
  const weekdayInitial = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  return (
    <div>
      <Text size="xs" c="dimmed" className={classes.scrollHint}>
        {t("common.table.scrollHint")}
      </Text>
      <div
        className={classes.wrapper}
        tabIndex={0}
        role="region"
        aria-label={t("common.table.scrollRegion")}
      >
      <table className={classes.grid} aria-label={t("daysOff.calendar.gridAria")}>
        <thead>
          <tr>
            <th className={classes.nameCell} scope="col">
              {t("daysOff.calendar.personColumn")}
            </th>
            {dates.map((iso) => {
              const holiday = holidayNames.get(iso);
              const isToday = iso === today;
              const todayLabel = t("daysOff.calendar.today");
              return (
                <th
                  key={iso}
                  scope="col"
                  className={`${classes.dayHeader}${offDayClass(holiday != null, isWeekend(iso))}${todayClass(iso, classes.todayHeader)}`}
                  title={isToday ? [todayLabel, holiday].filter(Boolean).join(" · ") : (holiday ?? undefined)}
                  aria-current={isToday ? "date" : undefined}
                >
                  {Number(iso.slice(8))}
                  <br />
                  {weekdayInitial(iso)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.users.map((user) => {
            const byDate = new Map(user.entries.map((e) => [e.date, e]));
            const isYou = user.userId === currentUserId;
            const name = isYou ? t("common.state.you") : user.userName;
            const teamNames = user.teams.map((team) => team.name);
            const highlighted = user.userId === highlightUserId;
            const rowAction = renderRowAction?.(user);
            const nameId = `${idPrefix}-name-${user.userId}`;
            return (
              <tr key={user.userId} ref={highlighted ? highlightRef : undefined}>
                <th
                  className={`${classes.nameCell}${highlighted ? ` ${classes.highlightName}` : ""}`}
                  scope="row"
                  // The row header's accessible name is the person's name ONLY — not the team and
                  // "Shared by" lines, nor the row action's own label that lives inside it.
                  aria-labelledby={nameId}
                  aria-current={highlighted ? "true" : undefined}
                >
                  <Group gap={4} wrap="nowrap" justify="space-between" align="flex-start">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text id={nameId} size="sm" fw={500} c={user.userDeleted ? "dimmed" : undefined}>
                        {name}
                      </Text>
                      {showTeams && !isYou && teamNames.length > 0 && (
                        <Text size="xs" c="dimmed" lineClamp={1} title={teamNames.join(" · ")}>
                          {teamNames.join(" · ")}
                        </Text>
                      )}
                      {user.sharedBy != null && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {t("sharing.sharedBy", { name: user.sharedBy })}
                        </Text>
                      )}
                    </Stack>
                    {rowAction}
                  </Group>
                </th>
                {dates.map((iso) => {
                  const entry = byDate.get(iso);
                  return (
                    <td
                      key={iso}
                      className={`${classes.dayCell}${offDayClass(holidayNames.has(iso), isWeekend(iso))}${todayClass(iso, classes.todayColumn)}`}
                      title={
                        entry
                          ? t("daysOff.calendar.cellTitle", {
                              name: user.userName,
                              date: iso,
                              type: entry.poolName ?? t(`daysOff.type.${entry.type}`),
                              amount: formatDays(entry.half ? 0.5 : 1, i18n.language),
                            })
                          : (holidayNames.get(iso) ?? undefined)
                      }
                    >
                      {entry && <div className={fillClass(entry)} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <Group gap="lg" mt="sm" wrap="wrap">
        <LegendItem swatch={classes.paid} label={t("daysOff.calendar.legendPaid")} />
        <LegendItem swatch={classes.unpaid} label={t("daysOff.calendar.legendUnpaid")} />
        <LegendItem swatch={classes.weekendDay} label={t("daysOff.calendar.legendWeekend")} />
        <LegendItem swatch={classes.holidayDay} label={t("daysOff.calendar.legendHoliday")} />
        {showsToday && <LegendItem swatch={classes.todaySwatch} label={t("daysOff.calendar.today")} />}
      </Group>
    </div>
  );
}
