import { dynamicKey } from "../utils/i18nKey";
import {
  Alert,
  Badge,
  Blockquote,
  Divider,
  Group,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { getPulseComments, getPulseResults, getPulseTrend, type PulseAggregationMode, type PulseDriverResult } from "../api/pulse";
import {
  PULSE_SMALL_SAMPLE,
  buildTrendSeries,
  deltaColor,
  enpsBandColor,
  enpsBandKey,
  formatSigned,
} from "../utils/pulseResults";

const PulseTrendChart = lazy(() => import("./PulseTrendChart"));

/** The methodology hint (v2.6.4): the DashboardHero info-icon idiom — the tooltip text doubles
 *  as the icon's accessible name, so the explanation is also reachable without a pointer.
 *  Exported for the Trend tab (PulseTrend.tsx), which reuses it beside its metric picker. */
export function HintIcon({ label }: { label: string }) {
  return (
    <Tooltip label={label} multiline w={280}>
      <IconInfoCircle
        size={14}
        color="var(--mantine-color-dimmed)"
        style={{ flexShrink: 0 }}
        role="img"
        aria-label={label}
      />
    </Tooltip>
  );
}

function DriverRow({ driver, questionLabel }: { driver: PulseDriverResult; questionLabel: string }) {
  const { t } = useTranslation();
  return (
    <Table.Tr>
      <Table.Td>{questionLabel}</Table.Td>
      <Table.Td>{driver.mean != null ? driver.mean.toFixed(1) : "—"}</Table.Td>
      <Table.Td>{driver.favorablePct != null ? `${driver.favorablePct.toFixed(1)}%` : "—"}</Table.Td>
      <Table.Td>{driver.unfavorablePct != null ? `${driver.unfavorablePct.toFixed(1)}%` : "—"}</Table.Td>
      <Table.Td>{driver.validCount}</Table.Td>
      <Table.Td>
        {driver.meanDelta != null ? (
          <Text size="sm" c={deltaColor(driver.meanDelta)}>
            {formatSigned(driver.meanDelta, 1)}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {/* The favorable-share change vs the previous cycle, in percentage points (v2.6.2 —
            the wire always carried it; the table finally shows it). */}
        {driver.favorableDeltaPp != null ? (
          <Text size="sm" c={deltaColor(driver.favorableDeltaPp)}>
            {formatSigned(driver.favorableDeltaPp, 1)} {t("pulse.results.ppUnit")}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

/**
 * One team's results block for a closed cycle: the eNPS headline with its previous-cycle
 * delta, the promoter/passive/detractor split, the per-question table (fixed Q2-Q5 localized,
 * the rotating question in the server's snapshotted wording), the trend chart, and — for
 * callers who monitor this team — the anonymized comments. The response count is always
 * visible, and nothing is ever framed as statistically significant. A scope under the
 * k-anonymity floor renders the withheld state instead of numbers.
 */
export default function PulseTeamResultCard({
  cycleId,
  teamId,
  teamName,
  mode,
  canMonitor,
  commentsOnly = false,
}: {
  cycleId: number;
  teamId: number;
  teamName: string;
  mode: PulseAggregationMode;
  canMonitor: boolean;
  /** A fill-gated monitor (a manager who didn't respond): skip the aggregate/trend queries
   *  and render only the comments section their monitoring right still covers. */
  commentsOnly?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pulseResults", cycleId, teamId, mode],
    queryFn: () => getPulseResults(cycleId, teamId, mode),
    retry: false,
    enabled: !commentsOnly,
  });
  const trend = useQuery({
    queryKey: ["pulseTrend", teamId, mode],
    queryFn: () => getPulseTrend(teamId, mode),
    retry: false,
    enabled: !commentsOnly,
  });
  const comments = useQuery({
    queryKey: ["pulseComments", cycleId, teamId, mode],
    queryFn: () => getPulseComments(cycleId, teamId, mode),
    enabled: canMonitor,
    retry: false,
  });

  const trendSeries = trend.data ? buildTrendSeries(trend.data.points) : [];
  const questionLabel = (driver: PulseDriverResult) =>
    driver.question === "ROTATING"
      ? ((i18n.resolvedLanguage === "pl" ? driver.rotatingTextPl : driver.rotatingTextEn) ?? "")
      : t(dynamicKey(`pulse.${driver.question.toLowerCase()}`));

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="baseline">
          <Title order={4}>{teamName}</Title>
          {data && (
            <Text size="sm" c="dimmed">
              {t("pulse.results.responses", {
                completed: data.responseCount,
                participants: data.participantCount,
                rate: data.responseRate,
              })}
            </Text>
          )}
        </Group>

        {!commentsOnly && isLoading && <Skeleton height={120} radius="sm" />}
        {!commentsOnly && isError && (
          <Alert color="red" variant="light">
            {t("pulse.results.loadError")}
          </Alert>
        )}

        {data?.insufficientResponses && (
          <Text c="dimmed" py="md">
            {t("pulse.results.notEnoughResponses")}
          </Text>
        )}

        {data && !data.insufficientResponses && data.enps && (
          <>
            {/* Small scopes are volatile — at n=3 one person switching bands moves the score
                by ±33 points. Say so rather than letting swings be over-read (v2.6.2). */}
            {data.responseCount < PULSE_SMALL_SAMPLE && (
              <Text size="xs" c="dimmed">
                {t("pulse.results.smallSample")}
              </Text>
            )}
            <Group align="baseline" gap="md">
              {/* Contextual band color + caption (v2.6.2) — approximate industry framing,
                  deliberately coarse: red below 0, neutral to +20, teal above. */}
              <Text fz={40} fw={600} lh={1} c={enpsBandColor(data.enps.score)}>
                {data.enps.score > 0 ? `+${data.enps.score}` : data.enps.score}
              </Text>
              <Stack gap={0}>
                <Group gap={4} wrap="nowrap">
                  <Text size="sm" c="dimmed">
                    {t("pulse.results.enps")}
                  </Text>
                  <HintIcon label={t("pulse.results.hint.enps")} />
                </Group>
                <Text size="xs" c="dimmed">
                  {t(`pulse.results.band.${enpsBandKey(data.enps.score)}`)}
                </Text>
              </Stack>
              {data.previous && (
                <Badge color={deltaColor(data.previous.enpsDelta)} variant="light">
                  {formatSigned(data.previous.enpsDelta)} {t("pulse.results.deltaVsPrevious")}
                </Badge>
              )}
            </Group>
            <Progress.Root size="lg">
              <Progress.Section value={data.enps.promoterPct} color="teal" />
              <Progress.Section value={data.enps.passivePct} color="gray" />
              <Progress.Section value={data.enps.detractorPct} color="red" />
            </Progress.Root>
            <Group gap="lg">
              <Text size="xs" c="dimmed">
                {t("pulse.results.promoters")} {data.enps.promoterPct.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {t("pulse.results.passives")} {data.enps.passivePct.toFixed(1)}%
              </Text>
              <Text size="xs" c="dimmed">
                {t("pulse.results.detractors")} {data.enps.detractorPct.toFixed(1)}%
              </Text>
            </Group>

            {data.drivers && (
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("pulse.results.question")}</Table.Th>
                    {/* Every metric header carries a how-is-this-computed hint (v2.6.4). */}
                    {(["mean", "favorable", "unfavorable", "validCount", "meanDelta", "favorableDelta"] as const).map(
                      (metric) => (
                        <Table.Th key={metric}>
                          <Group gap={4} wrap="nowrap">
                            {t(`pulse.results.${metric}`)}
                            <HintIcon label={t(`pulse.results.hint.${metric}`)} />
                          </Group>
                        </Table.Th>
                      ),
                    )}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.drivers.map((driver) => (
                    <DriverRow key={driver.question} driver={driver} questionLabel={questionLabel(driver)} />
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        )}

        {!commentsOnly && (
          <>
            <Divider label={t("pulse.results.trendTitle")} labelPosition="left" />
            {trendSeries.length >= 2 ? (
              <Suspense fallback={<Skeleton height={200} radius="sm" />}>
                <PulseTrendChart
                  data={trendSeries}
                  series={[{ name: "enps", label: t("pulse.results.enps"), color: "lettuce.6" }]}
                />
              </Suspense>
            ) : (
              <Text size="sm" c="dimmed">
                {t("pulse.results.trendPending")}
              </Text>
            )}
          </>
        )}

        {canMonitor && comments.data && !comments.data.insufficientResponses && comments.data.items.length > 0 && (
          <>
            <Divider label={t("pulse.results.commentsTitle")} labelPosition="left" />
            <Text size="xs" c="dimmed">
              {t("pulse.results.commentsAnonymized")}
            </Text>
            <Stack gap="xs">
              {comments.data.items.map((comment, index) => (
                <Blockquote key={index} p="sm">
                  {comment}
                </Blockquote>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
