import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { DaysOffCalendarEntry, DaysOffCalendarResponse } from "../api/client";
import { getUserId } from "../api/client";
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
  const tentative = entry.status === "REQUESTED";
  const paid = entry.type === "PAID";
  const color = tentative
    ? paid
      ? classes.tentativePaid
      : classes.tentativeUnpaid
    : paid
      ? classes.paid
      : classes.unpaid;
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
 * holiday columns are dimmed (the holiday's name rides the column header tooltip); accepted
 * days render as solid bars (PAID teal / UNPAID gray), pending ones striped, half days as
 * half-filled cells. A real `<table>` with per-cell `title` descriptions; hand-rolled — no
 * calendar dependency.
 */
export default function DaysOffMonthGrid({ data }: { data: DaysOffCalendarResponse }) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const dates = monthDates(data.month);
  const holidayNames = new Map(data.holidays.map((h) => [h.date, h.name]));
  const weekdayInitial = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  return (
    <div className={classes.wrapper}>
      <table className={classes.grid} aria-label={t("daysOff.calendar.gridAria")}>
        <thead>
          <tr>
            <th className={classes.nameCell} scope="col">
              {t("daysOff.calendar.personColumn")}
            </th>
            {dates.map((iso) => {
              const holiday = holidayNames.get(iso);
              return (
                <th
                  key={iso}
                  scope="col"
                  className={`${classes.dayHeader}${offDayClass(holiday != null, isWeekend(iso))}`}
                  title={holiday ?? undefined}
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
            const name =
              user.userId === currentUserId ? t("common.state.you") : user.userName;
            return (
              <tr key={user.userId}>
                <th className={classes.nameCell} scope="row">
                  <Text size="sm" fw={500} c={user.userDeleted ? "dimmed" : undefined} span>
                    {name}
                  </Text>
                </th>
                {dates.map((iso) => {
                  const entry = byDate.get(iso);
                  return (
                    <td
                      key={iso}
                      className={`${classes.dayCell}${offDayClass(holidayNames.has(iso), isWeekend(iso))}`}
                      title={
                        entry
                          ? t("daysOff.calendar.cellTitle", {
                              name: user.userName,
                              date: iso,
                              type: t(`daysOff.type.${entry.type}`),
                              status: t(`daysOff.status.${entry.status}`),
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

      <Group gap="lg" mt="sm" wrap="wrap">
        <LegendItem swatch={classes.paid} label={t("daysOff.calendar.legendPaid")} />
        <LegendItem swatch={classes.unpaid} label={t("daysOff.calendar.legendUnpaid")} />
        <LegendItem swatch={classes.tentativePaid} label={t("daysOff.calendar.legendRequested")} />
        <LegendItem swatch={classes.weekendDay} label={t("daysOff.calendar.legendWeekend")} />
        <LegendItem swatch={classes.holidayDay} label={t("daysOff.calendar.legendHoliday")} />
      </Group>
    </div>
  );
}
