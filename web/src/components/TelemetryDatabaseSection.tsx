import { useTranslation } from "react-i18next";
import { Stack, Text } from "@mantine/core";
import type { TelemetryCurrent, TelemetryRange } from "../api/telemetry";
import { formatDateTime } from "../utils/datetime";
import { formatBytes, formatCount } from "../utils/telemetryFormat";
import { databaseGroupName, databaseTableName, usageOf } from "../utils/telemetryNames";
import { databaseSets } from "../utils/telemetryTrend";
import { FirstSampleNote } from "./TelemetryMemorySection";
import TelemetryProcessHeader from "./TelemetryProcessHeader";
import TelemetryTrend from "./TelemetryTrend";
import TelemetryValueTable from "./TelemetryValueTable";

/**
 * Database: per process its connection pool at the latest sample ("n of the maximum"), then what the application takes in the
 * database (measured hourly) - the database and each table group - and how many rows each counted table holds; three trends
 * (the pool's connections, bytes, counts).
 */
export default function TelemetryDatabaseSection({ current, range, active }: { current: TelemetryCurrent; range: TelemetryRange; active: boolean }) {
  const { t, i18n } = useTranslation();
  const { database } = current;
  const poolMax = current.limits.poolMaxSize;
  return (
    <Stack gap="md">
      {current.processes.length === 0 ? (
        <FirstSampleNote />
      ) : (
        current.processes.map((process) => (
          <Stack key={process.id} gap="xs">
            <TelemetryProcessHeader process={process} />
            {process.sampledAt == null ? (
              <FirstSampleNote />
            ) : (
              <TelemetryValueTable
                label={t("telemetry.database.poolAria", { process: process.instance })}
                rows={[
                  { label: t("telemetry.database.poolAcquired"), value: usageOf(t, process.pool.acquired, poolMax) },
                  { label: t("telemetry.database.poolIdle"), value: formatCount(process.pool.idle) },
                  { label: t("telemetry.database.poolPending"), value: formatCount(process.pool.pending) },
                  { label: t("telemetry.database.poolAllocated"), value: usageOf(t, process.pool.allocated, poolMax) },
                ]}
              />
            )}
          </Stack>
        ))
      )}
      {database == null ? (
        <Text size="sm" c="dimmed">
          {t("telemetry.database.notYet")}
        </Text>
      ) : (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t("telemetry.database.measuredAt", { time: formatDateTime(database.measuredAt, i18n.language) })}
          </Text>
          <TelemetryValueTable
            label={t("telemetry.database.sizeAria")}
            rows={[
              { label: t("telemetry.database.size"), value: formatBytes(database.databaseBytes) },
              ...database.groups.map((group) => ({ label: databaseGroupName(group.name, t), value: formatBytes(group.bytes) })),
            ]}
          />
          <TelemetryValueTable
            label={t("telemetry.database.rowsAria")}
            rows={database.rows.map((row) => ({ label: databaseTableName(row.name, t), value: formatCount(row.count) }))}
          />
        </Stack>
      )}
      <TelemetryTrend group="database" range={range} sets={databaseSets} label={t("telemetry.section.database")} active={active} />
    </Stack>
  );
}
