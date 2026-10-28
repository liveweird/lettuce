import type { ParseKeys, TFunction } from "i18next";
import { formatCount } from "./telemetryFormat";

// The names the server writes on the database figures (table groups and counted tables, `StorageCollectors.kt`) in words. Literal
// key maps, never a template, so the key-usage tests and `tsc` see every key named in the source. A name a newer server adds that
// is not listed here reads as itself, so a figure is never blanked out.

const GROUP_KEYS: Record<string, ParseKeys> = {
  people: "telemetry.database.group.people",
  teams: "telemetry.database.group.teams",
  feedback: "telemetry.database.group.feedback",
  meetings: "telemetry.database.group.meetings",
  goals: "telemetry.database.group.goals",
  reviews: "telemetry.database.group.reviews",
  days_off: "telemetry.database.group.days_off",
  pulse: "telemetry.database.group.pulse",
  platform: "telemetry.database.group.platform",
};

const TABLE_KEYS: Record<string, ParseKeys> = {
  users: "telemetry.database.table.users",
  teams: "telemetry.database.table.teams",
  feedbacks: "telemetry.database.table.feedbacks",
  one_on_one_meetings: "telemetry.database.table.one_on_one_meetings",
  goals: "telemetry.database.table.goals",
  team_kpis: "telemetry.database.table.team_kpis",
  performance_reviews: "telemetry.database.table.performance_reviews",
  days_off_requests: "telemetry.database.table.days_off_requests",
  impact_log_entries: "telemetry.database.table.impact_log_entries",
  succession_plans: "telemetry.database.table.succession_plans",
  pulse_responses: "telemetry.database.table.pulse_responses",
  notifications: "telemetry.database.table.notifications",
  document_shares: "telemetry.database.table.document_shares",
  telemetry_samples: "telemetry.database.table.telemetry_samples",
};

/** A table group ("people", "days_off", …) in words. */
export function databaseGroupName(name: string, t: TFunction): string {
  const key = GROUP_KEYS[name];
  return key === undefined ? name : t(key);
}

/** A counted table ("users", "feedbacks", …) in words. */
export function databaseTableName(name: string, t: TFunction): string {
  const key = TABLE_KEYS[name];
  return key === undefined ? name : t(key);
}

/** "n of N" for a bounded thing (`format` renders both numbers); the bare dash when the figure was not measured. */
export function usageOf(
  t: TFunction,
  used: number | null | undefined,
  limit: number,
  format: (value: number | null | undefined) => string = formatCount,
): string {
  return used == null ? format(used) : t("telemetry.of", { used: format(used), limit: format(limit) });
}
